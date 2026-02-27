from flask import Blueprint, jsonify, request, g
from app.services.scheduler_service import get_scheduler_status, get_scheduler_config, update_scheduler_config
from app.middleware.auth import token_required, role_required
from datetime import datetime, timezone

bp = Blueprint('scheduler', __name__)

VALID_INTERVALS = [30, 35, 40, 45, 50, 60, 120, 180]
VALID_DAYS = {'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'}


@bp.route('/scheduler/status', methods=['GET'])
@token_required
@role_required('A', 'S')
def scheduler_status():
    """Return background scheduler status for both scan types."""
    try:
        status = get_scheduler_status()
        return jsonify({
            'status': 'success',
            **status,
            'timestamp': datetime.now(timezone.utc).isoformat()
        })
    except Exception as e:
        return jsonify({
            'status': 'Error',
            'message': str(e),
            'timestamp': datetime.now(timezone.utc).isoformat()
        }), 500


@bp.route('/scheduler/config', methods=['GET'])
@token_required
@role_required('A', 'S')
def get_config():
    """Return current schedule configuration."""
    try:
        cfg = get_scheduler_config()
        return jsonify({'status': 'success', **cfg})
    except Exception as e:
        return jsonify({'status': 'Error', 'message': str(e)}), 500


@bp.route('/scheduler/config', methods=['PUT'])
@token_required
@role_required('A', 'S')
def put_config():
    """Update schedule configuration and reschedule jobs."""
    body = request.get_json(silent=True) or {}

    interval = body.get('intervalMinutes')
    start_hour = body.get('startHour')
    end_hour = body.get('endHour')
    active_days = body.get('activeDays')

    # Validation
    errors = []
    if interval not in VALID_INTERVALS:
        errors.append(f'intervalMinutes must be one of {VALID_INTERVALS}')
    if not isinstance(start_hour, int) or start_hour < 0 or start_hour > 23:
        errors.append('startHour must be 0-23')
    if not isinstance(end_hour, int) or end_hour < 0 or end_hour > 23:
        errors.append('endHour must be 0-23')
    if not isinstance(active_days, list) or not active_days:
        errors.append('activeDays must be a non-empty array')
    elif not all(d in VALID_DAYS for d in active_days):
        errors.append(f'activeDays values must be from {sorted(VALID_DAYS)}')

    if errors:
        return jsonify({'status': 'Error', 'message': '; '.join(errors)}), 400

    try:
        updated_by = getattr(g, 'current_user', {}).get('userId', 'unknown')
        update_scheduler_config(interval, start_hour, end_hour, active_days, updated_by)
        cfg = get_scheduler_config()
        return jsonify({'status': 'success', 'message': 'Schedule updated', **cfg})
    except Exception as e:
        return jsonify({'status': 'Error', 'message': str(e)}), 500
