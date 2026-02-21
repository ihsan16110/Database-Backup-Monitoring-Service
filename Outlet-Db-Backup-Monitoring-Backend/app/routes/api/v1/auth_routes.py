from flask import Blueprint, jsonify, request, g
from app.services.auth_service import AuthService
from app.middleware.auth import token_required
from datetime import datetime, timezone

bp = Blueprint('auth', __name__)


@bp.route('/auth/login', methods=['POST'])
def login():
    """Authenticate user and return JWT token.

    Request body:
        { "userId": "32787", "password": "plaintext" }
    """
    body = request.get_json(silent=True) or {}
    user_id = body.get('userId', '').strip()
    password = body.get('password', '')

    if not user_id or not password:
        return jsonify({
            'status': 'Error',
            'message': 'userId and password are required'
        }), 400

    auth_service = AuthService()
    user = auth_service.authenticate_user(user_id, password)

    if not user:
        return jsonify({
            'status': 'Error',
            'message': 'Invalid credentials'
        }), 401

    token = auth_service.generate_token(user)

    return jsonify({
        'status': 'success',
        'token': token,
        'user': user,
        'timestamp': datetime.now(timezone.utc).isoformat()
    })


@bp.route('/auth/me', methods=['GET'])
@token_required
def get_current_user():
    """Return the current user's info from the JWT token.

    Used by the frontend to validate a stored token on page refresh.
    """
    return jsonify({
        'status': 'success',
        'user': {
            'userId': g.current_user['userId'],
            'userName': g.current_user['userName'],
            'userType': g.current_user['userType'],
        }
    })
