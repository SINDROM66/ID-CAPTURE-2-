const fs = require('fs');

const parserCode = fs.readFileSync('js/ug-id-parser.js', 'utf8');
const runnerCode = fs.readFileSync('js/stress-test-runner.js', 'utf8');

// Evaluate them in this context
eval(parserCode);
eval(runnerCode);

runStressTests();
