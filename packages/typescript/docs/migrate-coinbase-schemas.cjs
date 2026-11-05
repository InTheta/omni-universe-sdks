// CDP 1.60.0 EIP-712 map migration to Zod 4's explicit record key schema.
// Pin source hashes: an upstream change must be reviewed instead of silently patched.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const rootArg = process.argv.indexOf('--root');
if (rootArg >= 0 && !process.argv[rootArg + 1]) throw new Error('--root requires an installation directory');
const root = rootArg < 0 ? path.resolve(__dirname, '..') : path.resolve(process.argv[rootArg + 1]);
const check = process.argv.includes('--check');
const specs = [
  ['_esm', '7a3adae0bbae10a06f0f8d9d048ba7d54621b87ec2154d4726efe1233aa0b292', 'z'],
  ['_cjs', '7b20273d74e5b696fc3585c70ede912e292a32511b24e8b031bc8b44a6a27f6e', 'zod_2.z']
];
const pending = [];
for (const [format, digest, z] of specs) {
  const file = path.join(root, 'node_modules/@coinbase/cdp-sdk', format, 'policies/evmSchema.js');
  const before = fs.readFileSync(file, 'utf8');
  const oldText = 'types: ' + z + '.record(' + z + '.array(';
  const newText = 'types: ' + z + '.record(' + z + '.string(), ' + z + '.array(';
  const original = before.includes(newText) ? before.replace(newText, oldText) : before;
  if (crypto.createHash('sha256').update(original).digest('hex') !== digest)
    throw new Error('Unsupported CDP EIP-712 schema source: ' + format);
  const occurrences = original.split(oldText).length - 1;
  if (occurrences !== 1) throw new Error('Expected exactly one CDP EIP-712 record schema');
  const migrated = original.replace(oldText, newText);
  if (check && before !== migrated)
    throw new Error('CDP schema migration missing: run the guarded migration for this installation');
  pending.push({file, before, migrated});
}
// Verify every reviewed input before mutating either build.
for (const {file, before, migrated} of pending) if (!check && before !== migrated) fs.writeFileSync(file, migrated);
