const fs = require('fs');

const parserCode = fs.readFileSync('js/ug-id-parser.js', 'utf8');
const runnerCode = fs.readFileSync('js/stress-test-runner.js', 'utf8');

eval(parserCode);
eval(runnerCode);

const results = runStressTests();

console.log("\n\n═══════════════════════════════════════════");
console.log("INDEPENDENT AUDIT RESULTS");
console.log("═══════════════════════════════════════════");
console.log(`TOTAL TEXT TESTS: ${results.total}`);
console.log(`PASSED: ${results.passed}`);
console.log(`FAILED: ${results.failed}`);
if (results.failed > 0) {
    console.log("FAILURE DETAILS:");
    results.failures.forEach(f => {
        console.log(`Test #${f.id} - ${f.name}`);
        f.mismatches.forEach(m => {
            console.log(`  ${m}`);
        });
        console.log(`Verdict:  [BUG IN PARSER / BUG IN TEST EXPECTATION]`);
    });
}
console.log("═══════════════════════════════════════════");
