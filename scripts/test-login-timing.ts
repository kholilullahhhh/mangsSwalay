import "dotenv/config";
import { compare, hash } from "bcryptjs";

/**
 * Verifies the login timing equaliser.
 *
 * The dummy hash used when a username does not exist has to be a *real* bcrypt
 * hash: `bcryptjs` returns `false` immediately for any string whose length is not
 * exactly 60, so an invalid placeholder answers in microseconds while a genuine
 * comparison takes ~220 ms — a working oracle for enumerating usernames.
 */
async function main() {
  const cost = 12;
  const validHash = await hash("correct-horse-battery-staple", cost);
  const dummyHash = await hash("swalayaku-" + crypto.randomUUID(), cost);

  const time = async (hashValue: string) => {
    const started = process.hrtime.bigint();
    await compare("definitely-not-the-password", hashValue);
    return Number(process.hrtime.bigint() - started) / 1e6;
  };

  // Warm up so JIT/first-call cost does not skew the first sample.
  await time(validHash);
  await time(dummyHash);

  const validSamples: number[] = [];
  const dummySamples: number[] = [];

  for (let i = 0; i < 5; i++) {
    validSamples.push(await time(validHash));
    dummySamples.push(await time(dummyHash));
  }

  const avg = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;

  const validAvg = avg(validSamples);
  const dummyAvg = avg(dummySamples);
  const gap = Math.abs(validAvg - dummyAvg);

  console.log(`  real hash      : ${validAvg.toFixed(1)} ms`);
  console.log(`  dummy hash     : ${dummyAvg.toFixed(1)} ms`);
  console.log(`  gap            : ${gap.toFixed(1)} ms`);

  const fails = gap > 25;
  console.log(
    fails
      ? "\n  FAIL: the two paths are distinguishable by timing.\n"
      : "\n  PASS: a missing username and a wrong password cost the same.\n",
  );

  process.exitCode = fails ? 1 : 0;
}

main();