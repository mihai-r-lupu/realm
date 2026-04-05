// sample-code/data-processor.ts
// Demo file for Mode 1. Contains quality issues only — no security vulnerabilities.

export function processRecords(d: any[]) {
  let r = [];
  for (let i = 0; i < d.length; i++) {
    if (d[i].active == true) {
      r.push({
        id: d[i].id,
        n: d[i].firstName + ' ' + d[i].lastName,
        e: d[i].emailAddress,
      });
    }
  }
  return r;
}

export function calc(items: any[]) {
  let t = 0;
  items.forEach(x => { t += x.price * x.qty; });
  return t;
}
