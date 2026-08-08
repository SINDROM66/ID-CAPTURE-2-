/**
 * Ugandan ID MRZ Parser - Stress Test Runner
 * Drop this file into your project as js/stress-test-runner.js
 * Run in browser console: runStressTests()
 */

const INLINE_TESTS = [
  // CATEGORY 1: CLEAN BASELINE
  {
    id: 1, name: "Single Given Name - Male", corruption: "clean",
    lines: ["IDUGA1234567890CM1234567890AB1","0010159M2907125UGA<<<<<<<<<<0","OTIM<<JOHN<<<<<<<<<<<<<<<<<<<<"],
    expected: {surname:"OTIM",givenName:"JOHN",sex:"Male",dob:"2000-10-15",nin:"CM1234567890AB"}
  },
  {
    id: 2, name: "Double Given Name - Female", corruption: "clean",
    lines: ["IDUGA9876543210CF9876543210CD2","9503054F2907125UGA<<<<<<<<<<8","AKELLO<<MARY<JANE<<<<<<<<<<<<<"],
    expected: {surname:"AKELLO",givenName:"MARY JANE",sex:"Female",dob:"1995-03-05",nin:"CF9876543210CD"}
  },
  {
    id: 3, name: "Triple Given Name - Old ID Style", corruption: "clean",
    lines: ["IDUGA0193072462CM000351093UXF7","0009139M2901215UGA190121<<<<<7","LYOMOKI<<SAMUEL<JUNIOR<ALEX<<"],
    expected: {surname:"LYOMOKI",givenName:"SAMUEL JUNIOR ALEX",sex:"Male",dob:"2000-09-13",nin:"CM000351093UXF"}
  },
  {
    id: 4, name: "Century Boundary 1999", corruption: "clean",
    lines: ["IDUGA5555555555CM5555555555EF3","9912319M2907125UGA<<<<<<<<<<2","MUKASA<<PATRICK<<<<<<<<<<<<<<<"],
    expected: {surname:"MUKASA",givenName:"PATRICK",sex:"Male",dob:"1999-12-31",nin:"CM5555555555EF"}
  },
  {
    id: 5, name: "Century Boundary 2001", corruption: "clean",
    lines: ["IDUGA6666666666CM6666666666GH4","0101015M2907125UGA<<<<<<<<<<9","NAMUYA<<SARAH<<<<<<<<<<<<<<<<<"],
    expected: {surname:"NAMUYA",givenName:"SARAH",sex:"Male",dob:"2001-01-01",nin:"CM6666666666GH"}
  },
  {
    id: 6, name: "Leap Year 2000-02-29", corruption: "clean",
    lines: ["IDUGA7777777777CM7777777777IJ5","0002293M2907125UGA<<<<<<<<<<1","OKELLO<<JAMES<<<<<<<<<<<<<<<<"],
    expected: {surname:"OKELLO",givenName:"JAMES",sex:"Male",dob:"2000-02-29",nin:"CM7777777777IJ"}
  },

  // CATEGORY 2: K-ARTIFACTS
  {
    id: 7, name: "K-Artifact KRODNEY", corruption: "k_artifact",
    lines: ["IDUGA0195889954CM94105102GF2L<","9410039M2907125UGA190712<<<<<0","KIMERA<<ELVIS<KRODNEY<<<<<<<<<"],
    expected: {surname:"KIMERA",givenName:"ELVIS RODNEY",sex:"Male",dob:"1994-10-03",nin:"CM94105102GFZL"}
  },
  {
    id: 8, name: "K-Artifact KELVIN→ELVIN", corruption: "k_artifact",
    lines: ["IDUGA1111111111CM1111111111KL6","8805055M2907125UGA<<<<<<<<<<3","MUKASA<<KELVIN<<<<<<<<<<<<<<<<"],
    expected: {surname:"MUKASA",givenName:"ELVIN",sex:"Male",dob:"1988-05-05",nin:"CM1111111111KL"}
  },
  {
    id: 9, name: "Real K-Name KATO (NO CHANGE)", corruption: "clean",
    lines: ["IDUGA2222222222CM2222222222MN7","7601011M2907125UGA<<<<<<<<<<4","KATO<<PETER<<<<<<<<<<<<<<<<<<"],
    expected: {surname:"KATO",givenName:"PETER",sex:"Male",dob:"1976-01-01",nin:"CM2222222222MN"}
  },
  {
    id: 10, name: "Real K-Name KIRABO (NO CHANGE)", corruption: "clean",
    lines: ["IDUGA1943196106CF0413510272QA<","0412317F3605174UGA<<<<<<<<<<4","AGABA<<MELLISA<KIRABO<<<<<<<<<"],
    expected: {surname:"AGABA",givenName:"MELLISA KIRABO",sex:"Female",dob:"2004-12-31",nin:"CF041351027ZQA"}
  },

  // CATEGORY 3: TRUNCATIONS
  {
    id: 11, name: "Truncation JUNIO→JUNIOR", corruption: "truncation",
    lines: ["IDUGA0193072462CM000351093UXF<","0009139M2901215UGA190121<<<<<7","LYOMOKI<<SAMUEL<JUNIO<<<<<<<<<<"],
    expected: {surname:"LYOMOKI",givenName:"SAMUEL JUNIOR",sex:"Male",dob:"2000-09-13",nin:"CM000351093UXF"}
  },
  {
    id: 12, name: "Truncation SAMUE→SAMUEL", corruption: "truncation",
    lines: ["IDUGA3333333333CM3333333333PQ8","9201013M2907125UGA<<<<<<<<<<6","OKOT<<SAMUE<<<<<<<<<<<<<<<<<<<"],
    expected: {surname:"OKOT",givenName:"SAMUEL",sex:"Male",dob:"1992-01-01",nin:"CM3333333333PQ"}
  },
  {
    id: 13, name: "Truncation TIMOTH→TIMOTHY", corruption: "truncation",
    lines: ["IDUGA4444444444CM4444444444RS9","8501017M2907125UGA<<<<<<<<<<2","OPIO<<TIMOTH<<<<<<<<<<<<<<<<<"],
    expected: {surname:"OPIO",givenName:"TIMOTHY",sex:"Male",dob:"1985-01-01",nin:"CM4444444444RS"}
  },
  {
    id: 14, name: "Truncation PATRIC→PATRICK", corruption: "truncation",
    lines: ["IDUGA5555555555CM5555555555TU0","7801012M2907125UGA<<<<<<<<<<8","ODONG<<PATRIC<<<<<<<<<<<<<<<<"],
    expected: {surname:"ODONG",givenName:"PATRICK",sex:"Male",dob:"1978-01-01",nin:"CM5555555555TU"}
  },

  // CATEGORY 4: MERGED NAMES
  {
    id: 15, name: "Merged ELVISRODNEY", corruption: "merged",
    lines: ["IDUGA0195889954CM94105102GF2L<","9410039M2907125UGA190712<<<<<0","KIMERA<<ELVISRODNEY<<<<<<<<<<<"],
    expected: {surname:"KIMERA",givenName:"ELVIS RODNEY",sex:"Male",dob:"1994-10-03",nin:"CM94105102GFZL"}
  },
  {
    id: 16, name: "Merged SAMUELJUNIOR", corruption: "merged",
    lines: ["IDUGA0193072462CM000351093UXF<","0009139M2901215UGA190121<<<<<7","LYOMOKI<<SAMUELJUNIOR<<<<<<<<<"],
    expected: {surname:"LYOMOKI",givenName:"SAMUEL JUNIOR",sex:"Male",dob:"2000-09-13",nin:"CM000351093UXF"}
  },

  // CATEGORY 5: NIN CORRUPTIONS
  {
    id: 17, name: "NIN O/0 Confusion", corruption: "nin_corruption",
    lines: ["IDUGA6666666666CM0O123456789A1","9001015M2907125UGA<<<<<<<<<<3","SSEKANDI<<ROBERT<<<<<<<<<<<<<<"],
    expected: {surname:"SSEKANDI",givenName:"ROBERT",sex:"Male",dob:"1990-01-01",nin:"CM00123456789A"}
  },
  {
    id: 18, name: "NIN I/1 at Tail", corruption: "nin_corruption",
    lines: ["IDUGA7777777777CM1234567890IB2","8801011M2907125UGA<<<<<<<<<<4","KALULE<<DAVID<<<<<<<<<<<<<<<<<"],
    expected: {surname:"KALULE",givenName:"DAVID",sex:"Male",dob:"1988-01-01",nin:"CM12345678901B"}
  },
  {
    id: 19, name: "NIN T/7 at Tail (Timothy)", corruption: "nin_corruption",
    lines: ["IDUGA1321896642CM0208310AUTAE<","0204174M3511048UGA<<<<<<<<<<7","MUYUNGA<<TIMOTHY<<<<<<<<<<<<<"],
    expected: {surname:"MUYUNGA",givenName:"TIMOTHY",sex:"Male",dob:"2002-04-17",nin:"CM0208310AU7AE"}
  },
  {
    id: 20, name: "NIN 6/G at Start", corruption: "nin_corruption",
    lines: ["IDUGA8888888888G61234567890AB3","9501017F2907125UGA<<<<<<<<<<5","NAKATO<<GRACE<<<<<<<<<<<<<<<<"],
    expected: {surname:"NAKATO",givenName:"GRACE",sex:"Female",dob:"1995-01-01",nin:"CG1234567890AB"}
  },

  // CATEGORY 6: DOB CORRUPTIONS
  {
    id: 21, name: "DOB Leading A (Mellisa)", corruption: "dob_corruption",
    lines: ["IDUGA1943196106CF0413510272QA<","A0412317F3605174UGA<<<<<<<<<4","AGABA<<MELLISA<KIRABO<<<<<<<<<"],
    expected: {surname:"AGABA",givenName:"MELLISA KIRABO",sex:"Female",dob:"2004-12-31",nin:"CF041351027ZQA"}
  },
  {
    id: 22, name: "DOB Leading L", corruption: "dob_corruption",
    lines: ["IDUGA9999999999CM9999999999XY4","L9201013M2907125UGA<<<<<<<<<6","OCAN<<BENON<<<<<<<<<<<<<<<<<<"],
    expected: {surname:"OCAN",givenName:"BENON",sex:"Male",dob:"1992-01-01",nin:"CM9999999999XY"}
  },
  {
    id: 23, name: "DOB O/0 Confusion", corruption: "dob_corruption",
    lines: ["IDUGA0000000000CM0000000000ZZ5","9O10155M2907125UGA<<<<<<<<<<7","AMANYA<<JOSHUA<<<<<<<<<<<<<<<<"],
    expected: {surname:"AMANYA",givenName:"JOSHUA",sex:"Male",dob:"1990-10-15",nin:"CM0000000000ZZ"}
  },

  // CATEGORY 7: EDGE CASES
  {
    id: 24, name: "Long Surname", corruption: "edge_case",
    lines: ["IDUGA1212121212CM1212121212AB6","8501011M2907125UGA<<<<<<<<<<2","MUSENERO<<JOE<<<<<<<<<<<<<<<<"],
    expected: {surname:"MUSENERO",givenName:"JOE",sex:"Male",dob:"1985-01-01",nin:"CM1212121212AB"}
  },
  {
    id: 25, name: "Short Surname + 3 Names", corruption: "edge_case",
    lines: ["IDUGA3434343434CM3434343434CD7","7601011M2907125UGA<<<<<<<<<<4","OK<<CHRISTOPHER<MICHAEL<PAUL<"],
    expected: {surname:"OK",givenName:"CHRISTOPHER MICHAEL PAUL",sex:"Male",dob:"1976-01-01",nin:"CM3434343434CD"}
  },
  {
    id: 26, name: "Single Char Artifacts", corruption: "edge_case",
    lines: ["IDUGA5656565656CM5656565656EF8","9101015M2907125UGA<<<<<<<<<<9","ABO<<PETER<L<K<<<<<<<<<<<<<<<"],
    expected: {surname:"ABO",givenName:"PETER",sex:"Male",dob:"1991-01-01",nin:"CM5656565656EF"}
  },
  {
    id: 27, name: "Consonant Garbage KLLLKL", corruption: "edge_case",
    lines: ["IDUGA7878787878CM7878787878GH9","8301013M2907125UGA<<<<<<<<<<1","ODOCH<<JOHN<KLLLKL<<<<<<<<<<<"],
    expected: {surname:"ODOCH",givenName:"JOHN",sex:"Male",dob:"1983-01-01",nin:"CM7878787878GH"}
  },
  {
    id: 28, name: "Female CF Prefix", corruption: "clean",
    lines: ["IDUGA9090909090CF9090909090IJ0","0202027F2907125UGA<<<<<<<<<<3","ATIM<<JANET<MARY<<<<<<<<<<<<<"],
    expected: {surname:"ATIM",givenName:"JANET MARY",sex:"Female",dob:"2002-02-02",nin:"CF9090909090IJ"}
  },
  {
    id: 29, name: "Century Pivot 2010", corruption: "clean",
    lines: ["IDUGA1010101010CM1010101010KL1","1001019M2907125UGA<<<<<<<<<<5","BWIRE<<MOSES<<<<<<<<<<<<<<<<<"],
    expected: {surname:"BWIRE",givenName:"MOSES",sex:"Male",dob:"2010-01-01",nin:"CM1010101010KL"}
  },
  {
    id: 30, name: "Invalid Date Returns Blank", corruption: "edge_case",
    lines: ["IDUGA2323232323CM2323232323MN2","9504319M2907125UGA<<<<<<<<<<7","KINTU<<ANDREW<<<<<<<<<<<<<<<<"],
    expected: {surname:"KINTU",givenName:"ANDREW",sex:"Male",dob:"",nin:"CM2323232323MN"}
  },

  // CATEGORY 8: OLD vs NEW FORMATS
  {
    id: 31, name: "Old ID Samuel", corruption: "old_format",
    lines: ["IDUGA0193072462CM000351093UXF<","0009139M2901215UGA190121<<<<<7","LYOMOKI<<SAMUEL<JUNIOR<<<<<<<<" ],
    expected: {surname:"LYOMOKI",givenName:"SAMUEL JUNIOR",sex:"Male",dob:"2000-09-13",nin:"CM000351093UXF"}
  },
  {
    id: 32, name: "New ID Elvis", corruption: "new_format",
    lines: ["IDUGA0195889954CM94105102GF2L<","9410039M2907125UGA190712<<<<<0","KIMERA<<ELVIS<RODNEY<<<<<<<<<<"],
    expected: {surname:"KIMERA",givenName:"ELVIS RODNEY",sex:"Male",dob:"1994-10-03",nin:"CM94105102GFZL"}
  },

  // CATEGORY 9: COMPLEX REAL NAMES
  {
    id: 33, name: "Luo Name Ochieng", corruption: "clean",
    lines: ["IDUGA4545454545CM4545454545QR3","8808081M2907125UGA<<<<<<<<<<6","OCHIENG<<BRIAN<OTIENO<<<<<<<<" ],
    expected: {surname:"OCHIENG",givenName:"BRIAN OTIENO",sex:"Male",dob:"1988-08-08",nin:"CM4545454545QR"}
  },
  {
    id: 34, name: "Baganda Name Nantongo", corruption: "clean",
    lines: ["IDUGA6767676767CF6767676767ST4","9505154F2907125UGA<<<<<<<<<<8","NANTONGO<<RACHAEL<NAMUKASA<<<<" ],
    expected: {surname:"NANTONGO",givenName:"RACHAEL NAMUKASA",sex:"Female",dob:"1995-05-15",nin:"CF6767676767ST"}
  },
  {
    id: 35, name: "Long Surname Twinomujuni", corruption: "clean",
    lines: ["IDUGA8989898989CM8989898989UV5","9001015M2907125UGA<<<<<<<<<<1","TWINOMUJUNI<<EMMANUEL<<<<<<<<" ],
    expected: {surname:"TWINOMUJUNI",givenName:"EMMANUEL",sex:"Male",dob:"1990-01-01",nin:"CM8989898989UV"}
  },

  // CATEGORY 10: NIGHTMARE SCENARIOS
  {
    id: 36, name: "Multiple Corruptions", corruption: "multiple_corruptions",
    lines: ["IDUGA1111111111CM1111111111KL6","A0010159M2907125UGA<<<<<<<<<3","OTIM<<JOHN<KPATRIC<<<<<<<<<<<"],
    expected: {surname:"OTIM",givenName:"JOHN PATRICK",sex:"Male",dob:"2000-10-15",nin:"CM1111111111KL"}
  },
  {
    id: 37, name: "Nightmare Everything Wrong", corruption: "nightmare",
    lines: ["IDUGA2222222222CM2222222222MN7","L8501012M2907125UGA<<<<<<<<<4","MUKASA<<KELVIN<TIMOTH<KLLLKL<<"],
    expected: {surname:"MUKASA",givenName:"ELVIN TIMOTHY",sex:"Male",dob:"1985-01-01",nin:"CM2222222222MN"}
  }
];

function runStressTests() {
  console.log("═══════════════════════════════════════════");
  console.log("  UGANDAN ID MRZ PARSER - STRESS TEST SUITE");
  console.log("═══════════════════════════════════════════\n");

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const test of INLINE_TESTS) {
    try {
      const result = parseMRZ(test.lines);
      let testPassed = true;
      const mismatches = [];

      for (const [key, expectedVal] of Object.entries(test.expected)) {
        const actualVal = result[key];
        if (actualVal !== expectedVal) {
          testPassed = false;
          mismatches.push(`${key}: expected "${expectedVal}", got "${actualVal}"`);
        }
      }

      if (testPassed) {
        passed++;
        console.log(`✅ TEST ${test.id}: ${test.name} [${test.corruption}]`);
      } else {
        failed++;
        failures.push({id: test.id, name: test.name, mismatches});
        console.log(`❌ TEST ${test.id}: ${test.name} [${test.corruption}]`);
        mismatches.forEach(m => console.log(`   ↳ ${m}`));
      }
    } catch (err) {
      failed++;
      failures.push({id: test.id, name: test.name, error: err.message});
      console.log(`💥 TEST ${test.id}: ${test.name} [${test.corruption}] - EXCEPTION`);
      console.log(`   ↳ ${err.message}`);
    }
  }

  console.log("\n═══════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} PASSED | ${failed} FAILED | ${INLINE_TESTS.length} TOTAL`);
  console.log("═══════════════════════════════════════════");

  if (failed > 0) {
    console.log("\n📋 FAILURE SUMMARY:");
    failures.forEach(f => {
      console.log(`   Test ${f.id}: ${f.name}`);
      if (f.mismatches) f.mismatches.forEach(m => console.log(`      - ${m}`));
      if (f.error) console.log(`      - EXCEPTION: ${f.error}`);
    });
  }

  return {passed, failed, total: INLINE_TESTS.length, failures};
}

// Auto-run if in browser with parseMRZ available
if (typeof parseMRZ === 'function') {
  console.log("Stress test runner loaded. Call runStressTests() to execute.");
} else {
  console.warn("parseMRZ not found. Ensure ug-id-parser.js is loaded first.");
}
