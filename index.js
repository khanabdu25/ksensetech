#!/usr/bin/env node

import readline from "readline";

const API_URL =
  "https://assessment.ksensetech.com/api/patients?page=1&limit=10";

const SUBMIT_URL = "https://assessment.ksensetech.com/api/submit-assessment";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// ---- Utility helpers ----

function isInvalid(value) {
  return value === null || value === undefined || value === "";
}

function parseBP(bp) {
  if (isInvalid(bp) || typeof bp !== "string") return null;

  const [sys, dia] = bp.split("/").map(Number);
  if (Number.isNaN(sys) || Number.isNaN(dia)) return null;

  return { sys, dia };
}

// ---- Risk scoring ----

function bpScore(bp) {
  const parsed = parseBP(bp);
  if (!parsed) return { score: 0, invalid: true };

  const { sys, dia } = parsed;

  console.log("sys", sys);
  console.log("dia", dia);

  if (sys < 120 && dia < 80) return { score: 0 };
  if (sys >= 120 && sys <= 129 && dia < 80) return { score: 1 };
  if ((sys >= 130 && sys <= 139) || (dia >= 80 && dia <= 89))
    return { score: 2 };
  if (sys >= 140 || dia >= 90) return { score: 3 };

  return { score: 0 };
}

function tempScore(temp) {
  if (isInvalid(temp) || typeof temp !== "number") {
    return { score: 0, invalid: true };
  }

  if (temp <= 99.5) return { score: 0 };
  if (temp >= 99.6 && temp <= 100.9) return { score: 1 };
  if (temp >= 101) return { score: 2 };

  return { score: 0 };
}

function ageScore(age) {
  if (isInvalid(age) || typeof age !== "number") {
    return { score: 0, invalid: true };
  }

  if (age < 40) return { score: 0 };
  if (age >= 40 && age <= 65) return { score: 1 };
  if (age > 65) return { score: 2 };

  return { score: 0 };
}

// ---- Main processing ----

async function run(apiKey) {
  let page = 1;
  const limit = 10;

  let processedCount = 0;
  let totalExpected = null;
  let hasNext = true;

  const high_risk_patients = [];
  const fever_patients = [];
  const data_quality_issues = [];

  while (hasNext) {
    const url = `https://assessment.ksensetech.com/api/patients?page=${page}&limit=${limit}`;

    const res = await fetch(url, {
      headers: { "x-api-key": apiKey },
    });

    if (!res.ok) {
      throw new Error(`Patient API error (page ${page}): ${res.status}`);
    }

    const json = await res.json();

    const { data, pagination } = json;

    if (totalExpected === null) {
      totalExpected = pagination.total;
    }

    console.log(`Processing page ${page}, patients: ${data.length}`);

    for (const p of data) {
      let totalRisk = 0;

      const bp = bpScore(p.blood_pressure);
      const temp = tempScore(p.temperature);
      const age = ageScore(p.age);

      totalRisk += bp.score + temp.score + age.score;

      if (bp.invalid || temp.invalid || age.invalid) {
        data_quality_issues.push(p.patient_id);
      }

      if (typeof p.temperature === "number" && p.temperature >= 99.6) {
        fever_patients.push(p.patient_id);
      }

      if (totalRisk >= 4) {
        high_risk_patients.push(p.patient_id);
      }

      processedCount++;
    }

    hasNext = pagination.hasNext;
    page++;
  }

  if (processedCount !== totalExpected) {
    console.warn(
      `Warning: processed ${processedCount}, expected ${totalExpected}`
    );
  }

  const payload = {
    high_risk_patients,
    fever_patients,
    data_quality_issues,
  };

  //   const submitRes = await fetch(SUBMIT_URL, {
  //     method: "POST",
  //     headers: {
  //       "Content-Type": "application/json",
  //       "x-api-key": apiKey,
  //     },
  //     body: JSON.stringify(payload),
  //   });

  //   if (!submitRes.ok) {
  //     const errText = await submitRes.text();
  //     throw new Error(`Submission failed (${submitRes.status}): ${errText}`);
  //   }

  //   const submitJson = await submitRes.json();
  //   console.log("Submission successful!");
  //   console.log(submitJson);

  console.log("payload", JSON.stringify(payload, null, 2));
}

// ---- CLI prompt ----

rl.question("Enter API key: ", async (apiKey) => {
  try {
    await run(apiKey.trim());
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    rl.close();
  }
});
