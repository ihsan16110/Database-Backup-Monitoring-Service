from concurrent.futures import ThreadPoolExecutor, as_completed
from flask import Blueprint, jsonify, request, Response, stream_with_context
from app.services.backup_service import BackupMonitor
from app.services.outlet_sync_service import OutletSyncService
from app.middleware.auth import token_required, role_required
from datetime import datetime, date, timezone
import json
import time

bp = Blueprint('backup', __name__)


def _build_response(categorized, start_time):
    """Build a standardised JSON response from categorized backup data."""
    normal = categorized.get('normal', [])
    advanced = categorized.get('advancedDate', [])
    return {
        'status': 'success',
        'data': normal,
        'advancedDate': advanced,
        'count': len(normal),
        'advancedDateCount': len(advanced),
        'processingTime': round(time.time() - start_time, 2),
        'timestamp': datetime.now(timezone.utc).isoformat()
    }


@bp.route('/backup-status', methods=['GET'])
@token_required
@role_required('A', 'S')
def backup_status():
    """API endpoint to check backup status"""
    monitor = BackupMonitor()
    start_time = time.time()

    # Check if filters are provided (report mode vs live check)
    outlet = request.args.get('outlet')
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')

    # If any filter is provided, return filtered saved data without re-scanning
    if outlet or date_from or date_to:
        try:
            categorized = monitor.get_filtered_backup_stats(outlet, date_from, date_to)
            return jsonify(_build_response(categorized, start_time))
        except Exception as e:
            monitor.log_error(f"Filtered query error: {str(e)}", severity="CRITICAL")
            return jsonify({
                'status': 'Error',
                'message': 'Internal Server Error',
                'timestamp': datetime.now(timezone.utc).isoformat()
            }), 500

    try:
        outlets = monitor.get_outlets()
        if not outlets:
            return jsonify({
                'status': 'Error',
                'message': 'No Active Outlets Found',
                'timestamp': datetime.now(timezone.utc).isoformat()
            }), 404

        with ThreadPoolExecutor(max_workers=monitor.config.MAX_WORKERS) as executor:
            results = list(executor.map(monitor.check_server, outlets))

        # Persist results to database
        monitor.save_backup_status(results)

        # Fetch latest data from the table to show in frontend
        categorized = monitor.get_all_backup_stats()

        return jsonify(_build_response(categorized, start_time))

    except Exception as e:
        monitor.log_error(f"API Endpoint Error: {str(e)}", severity="CRITICAL")
        return jsonify({
            'status': 'Error',
            'message': 'Internal Server Error',
            'timestamp': datetime.now(timezone.utc).isoformat()
        }), 500


@bp.route('/backup-status/scan', methods=['GET'])
def scan_with_progress():
    """SSE endpoint: scan all outlets with real-time progress streaming."""
    monitor = BackupMonitor()

    # Parse optional scan_date for back-date scanning
    scan_date_str = request.args.get('scan_date')
    scan_date = None
    if scan_date_str:
        try:
            scan_date = date.fromisoformat(scan_date_str)
        except ValueError:
            return jsonify({
                'status': 'Error',
                'message': f'Invalid scan_date format: {scan_date_str}. Expected YYYY-MM-DD.',
                'timestamp': datetime.now(timezone.utc).isoformat()
            }), 400

    monitor.scan_date = scan_date

    def generate():
        try:
            # Sync outlets from central server before scanning
            sync_service = OutletSyncService()
            sync_result = sync_service.sync_outlets()
            if sync_result and (sync_result['inserted'] or sync_result['updated'] or sync_result['deactivated']):
                yield f"data: {json.dumps({'type': 'sync', 'inserted': sync_result['inserted'], 'updated': sync_result['updated'], 'deactivated': sync_result['deactivated']})}\n\n"

            outlets = monitor.get_outlets()
            if not outlets:
                yield f"data: {json.dumps({'type': 'error', 'message': 'No Active Outlets Found'})}\n\n"
                return

            total = len(outlets)
            results = []
            success = 0
            failed = 0

            yield f"data: {json.dumps({'type': 'start', 'total': total})}\n\n"

            with ThreadPoolExecutor(max_workers=monitor.config.MAX_WORKERS) as executor:
                futures = {executor.submit(monitor.check_server, o): o for o in outlets}
                for future in as_completed(futures):
                    result = future.result()
                    results.append(result)
                    if result['status'] == 'Successful':
                        success += 1
                    else:
                        failed += 1
                    yield f"data: {json.dumps({'type': 'progress', 'completed': len(results), 'total': total, 'success': success, 'failed': failed, 'current': result['outletCode']})}\n\n"

            monitor.save_backup_status(results)

            yield f"data: {json.dumps({'type': 'complete', 'total': total, 'success': success, 'failed': failed})}\n\n"
        except Exception as e:
            monitor.log_error(f"SSE scan error: {str(e)}", severity="CRITICAL")
            yield f"data: {json.dumps({'type': 'error', 'message': 'Internal Server Error'})}\n\n"

    response = Response(stream_with_context(generate()), content_type='text/event-stream')
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['X-Accel-Buffering'] = 'no'
    return response


@bp.route('/backup-stats', methods=['GET'])
@token_required
@role_required('A', 'S')
def backup_stats():
    """Read-only endpoint: returns saved records from D_Drive_Backup_Stat without scanning."""
    monitor = BackupMonitor()
    start_time = time.time()

    outlet = request.args.get('outlet')
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')

    try:
        if outlet or date_from or date_to:
            categorized = monitor.get_filtered_backup_stats(outlet, date_from, date_to)
        else:
            categorized = monitor.get_all_backup_stats()

        return jsonify(_build_response(categorized, start_time))
    except Exception as e:
        monitor.log_error(f"Backup stats read error: {str(e)}", severity="CRITICAL")
        return jsonify({
            'status': 'Error',
            'message': 'Internal Server Error',
            'timestamp': datetime.now(timezone.utc).isoformat()
        }), 500


@bp.route('/backup-status/sync', methods=['POST'])
@token_required
@role_required('A')
def sync_outlets():
    """Re-scan specific outlets by their codes.

    Request body:
        { "outlets": ["OUTLET001", "OUTLET005"] }

    Accepts 1 or more outlet codes. Scans only those servers,
    updates their records in D_Drive_Backup_Stat, and returns
    the updated results for the synced outlets.
    """
    monitor = BackupMonitor()
    start_time = time.time()

    body = request.get_json(silent=True) or {}
    outlet_codes = body.get('outlets', [])

    if not outlet_codes or not isinstance(outlet_codes, list):
        return jsonify({
            'status': 'Error',
            'message': 'Request body must include "outlets" as a non-empty array',
            'timestamp': datetime.now(timezone.utc).isoformat()
        }), 400

    try:
        # Fetch only the requested outlets from DB
        outlets = monitor.get_outlets_by_codes(outlet_codes)
        if not outlets:
            return jsonify({
                'status': 'Error',
                'message': 'No matching outlets found for the provided codes',
                'timestamp': datetime.now(timezone.utc).isoformat()
            }), 404

        # Scan only the selected servers in parallel
        with ThreadPoolExecutor(max_workers=monitor.config.MAX_WORKERS) as executor:
            results = list(executor.map(monitor.check_server, outlets))

        # Persist results to database (updates only these outlets for today)
        monitor.save_backup_status(results)

        # Count actual successes vs failures from scan results
        success_count = sum(1 for r in results if r['status'] == 'Successful')
        failed_count = len(results) - success_count

        # Return the full latest view (so frontend can refresh the dashboard)
        categorized = monitor.get_all_backup_stats()
        response = _build_response(categorized, start_time)
        response['syncedCount'] = len(results)
        response['syncSuccessCount'] = success_count
        response['syncFailedCount'] = failed_count

        return jsonify(response)

    except Exception as e:
        monitor.log_error(f"Sync endpoint error: {str(e)}", severity="CRITICAL")
        return jsonify({
            'status': 'Error',
            'message': 'Internal Server Error',
            'timestamp': datetime.now(timezone.utc).isoformat()
        }), 500


@bp.route('/backup-stats/daily-summary', methods=['GET'])
@token_required
@role_required('A', 'S')
def daily_summary():
    """Return per-day aggregated backup counts for the dashboard."""
    monitor = BackupMonitor()
    try:
        limit = request.args.get('limit', 30, type=int)
        days = monitor.get_daily_summary(limit)
        return jsonify({
            'status': 'success',
            'data': days,
            'timestamp': datetime.now(timezone.utc).isoformat()
        })
    except Exception as e:
        monitor.log_error(f"Daily summary error: {str(e)}", severity="CRITICAL")
        return jsonify({
            'status': 'Error',
            'message': 'Internal Server Error',
            'timestamp': datetime.now(timezone.utc).isoformat()
        }), 500


@bp.route('/outlets', methods=['GET'])
@token_required
@role_required('A', 'S')
def list_outlets():
    """Return the list of all outlet codes for filter dropdowns."""
    monitor = BackupMonitor()
    try:
        codes = monitor.get_outlet_list()
        return jsonify({'status': 'success', 'data': codes})
    except Exception as e:
        monitor.log_error(f"Outlets list error: {str(e)}", severity="CRITICAL")
        return jsonify({'status': 'Error', 'data': []}), 500
