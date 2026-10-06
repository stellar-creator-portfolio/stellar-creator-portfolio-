import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const TARGET_DIR = './.next';
const FORBIDDEN_STRING = 'SUPABASE_SERVICE_ROLE_KEY';

function checkFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  if (content.includes(FORBIDDEN_STRING)) {
    console.error(`❌ Security breach: ${FORBIDDEN_STRING} found in ${filePath}`);
    process.exit(1);
  }
}

function walkDir(dir) {
  const files = readdirSync(dir);
  for (const file of files) {
    const fullPath = join(dir, file);
    if (statSync(fullPath).isDirectory()) {
      walkDir(fullPath);
    } else if (fullPath.endsWith('.js') || fullPath.endsWith('.map')) {
      checkFile(fullPath);
    }
  }
}

try {
  console.log(`Checking for ${FORBIDDEN_STRING} in ${TARGET_DIR}...`);
  walkDir(TARGET_DIR);
  console.log('✅ Security check passed: No leaked keys found.');
  process.exit(0);
} catch (err) {
  if (err.code === 'ENOENT') {
    console.warn('⚠️ Build directory not found, skipping security check.');
    process.exit(0);
  } else {
    console.error(err);
    process.exit(1);
  }
}
