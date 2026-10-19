// Entry point: checks the Node.js version before loading anything that needs node:sqlite.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`\n  ADV·Flow needs Node.js 22.5 or newer — you have ${process.versions.node}.`);
  console.error('  Install the current LTS from https://nodejs.org (or: winget install OpenJS.NodeJS.LTS),');
  console.error('  then close and reopen the terminal and run: npm run dev\n');
  process.exit(1);
}
await import('./index.js');
