const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '..', 'src', 'environments', 'environment.ts');
let content = fs.readFileSync(envFile, 'utf8');

content = content.replace('SUPABASE_URL_PLACEHOLDER', process.env.SUPABASE_URL || '');
content = content.replace('SUPABASE_ANON_KEY_PLACEHOLDER', process.env.SUPABASE_ANON_KEY || '');

fs.writeFileSync(envFile, content);
console.log('Environment variables injected into environment.ts');
