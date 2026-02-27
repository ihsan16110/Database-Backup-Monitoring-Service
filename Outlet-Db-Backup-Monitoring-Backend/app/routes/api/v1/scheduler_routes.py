from flask import Blueprint, jsonify
from app.services.scheduler_service import get_scheduler_status
from app.middleware.auth import token_required, role_required
from datetime import datetime, timezone

bp = Blueprint('scheduler', __name__)


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
