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

  if (sys < 120 && dia < 80) return { score: 1 };
  if (sys >= 120 && sys <= 129 && dia < 80) return { score: 2 };
  if ((sys >= 130 && sys <= 139) || (dia >= 80 && dia <= 89))
    return { score: 3 };
  if (sys >= 140 || dia >= 90) return { score: 4 };

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

  if (age < 40) return { score: 1 };
  if (age <= 65) return { score: 1 };
  if (age > 65) return { score: 2 };

  return { score: 0 };
}

// ---- Main processing ----

async function run(apiKey) {
  const res = await fetch(API_URL, {
    headers: {
      "x-api-key": apiKey,
    },
  });

  if (!res.ok) {
    throw new Error(`Patient API error: ${res.status}`);
  }

  const json = await res.json();
  const patients = json.data;

  const high_risk_patients = [];
  const fever_patients = [];
  const data_quality_issues = [];

  for (const p of patients) {
    let totalRisk = 0;

    const bp = bpScore(p.blood_pressure);
    const temp = tempScore(p.temperature);
    const age = ageScore(p.age);

    totalRisk += bp.score + temp.score + age.score;

    if (bp.invalid || temp.invalid || age.invalid) {
      data_quality_issues.push(p.patient_id);
    }

    if (p.temperature >= 99.6) {
      fever_patients.push(p.patient_id);
    }

    if (totalRisk >= 4) {
      high_risk_patients.push(p.patient_id);
    }
  }

  const payload = {
    high_risk_patients,
    fever_patients,
    data_quality_issues,
  };

  const submitRes = await fetch(SUBMIT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`Submission failed (${submitRes.status}): ${errText}`);
  }

  const submitJson = await submitRes.json();
  console.log("Submission successful!");
  console.log(submitJson);
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
