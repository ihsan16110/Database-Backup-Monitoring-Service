import os
from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

def create_app():
    app = Flask(__name__)
    cors_origins = os.getenv('CORS_ORIGINS', 'http://localhost:3004,http://localhost:3005').split(',')
    CORS(app, resources={r"/api/*": {"origins": cors_origins}})
    
    # Register blueprints
    from app.routes.api.v1.backup_routes import bp as backup_bp
    app.register_blueprint(backup_bp, url_prefix='/api/v1')

    from app.routes.api.v1.ibstorage_routes import bp as ibstorage_bp
    app.register_blueprint(ibstorage_bp, url_prefix='/api/v1')

    from app.routes.api.v1.auth_routes import bp as auth_bp
    app.register_blueprint(auth_bp, url_prefix='/api/v1')

    return app