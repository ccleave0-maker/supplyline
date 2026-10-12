import 'dotenv/config';

// Tests always run against the separate test database, never your dev data.
if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL in server/.env to run tests');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.EMAIL_PROVIDER = 'console';
process.env.DEV_SHOW_LOGIN_CODE = 'true';
process.env.STORAGE_PROVIDER = 'local';
process.env.GOOGLE_CLIENT_ID = '';
