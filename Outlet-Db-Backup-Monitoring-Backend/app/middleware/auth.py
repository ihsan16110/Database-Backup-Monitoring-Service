from functools import wraps
from flask import request, jsonify, g
from app.services.auth_service import AuthService


def token_required(f):
    """Decorator that validates the JWT Bearer token.

    On success, sets g.current_user with the decoded token payload.
    On failure, returns 401 JSON response.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')

        if not auth_header.startswith('Bearer '):
            return jsonify({
                'status': 'Error',
                'message': 'Missing or invalid Authorization header'
            }), 401

        token = auth_header.split(' ', 1)[1]
        auth_service = AuthService()
        payload = auth_service.decode_token(token)

        if not payload:
            return jsonify({
                'status': 'Error',
                'message': 'Token is invalid or expired'
            }), 401

        g.current_user = payload
        return f(*args, **kwargs)

    return decorated


def role_required(*allowed_types):
    """Decorator that checks the user's role after token validation.

    Must be placed AFTER @token_required so g.current_user is available.
    Returns 403 if user's userType is not in allowed_types.
    """
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            user_type = g.current_user.get('userType', '')
            if user_type not in allowed_types:
                return jsonify({
                    'status': 'Error',
                    'message': 'Insufficient permissions'
                }), 403
            return f(*args, **kwargs)
        return decorated
    return decorator
