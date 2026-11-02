import { shortVanName, shortCleanerName } from '../src/lib/parse';

const vans: [string, string][] = [
  ['Excl Justlife FF PC HC23 [Hub] Dubai - JVC 2', 'HC23 · JVC 2'],
  ['Excl Justlife FF PC HC30 [Hub] Dubai - Jebel Ali Village (DG, AF, TG)', 'HC30 · Jebel Ali Village (DG, AF, TG)'],
  ['Excl Perfect Choice FF HC78 - Dubai DAMAC Hills 2', 'HC78 · Dubai DAMAC Hills 2'],
  ['Excl Justlife FF PC HC98 [Hub] Dubai - Palm Jumeirah <Temp>', 'HC98 · Palm Jumeirah'],
  ['Excl Perfect Choice FF HC46 Warqa', 'HC46'],
  ['Excl Perfect Choice FF [Hub] Dubai - HC51 Downtown 1', 'HC51 · HC51 Downtown 1'],
  ['', ''],
  ['Some van with no code', 'Some van with no code'],
];
const cleaners: [string, string, string][] = [
  ['Riza G M - Excl Justlife DTC PC HC23', 'Riza G M', 'HC23'],
  ['Susma W Excl Perfect Choice FF HC78', 'Susma W', 'HC78'],
  ['Melody D Excl Justlife FF PC HC98', 'Melody D', 'HC98'],
  ['Rose Angel P Excl Justlife DTC PC HC46', 'Rose Angel P', 'HC46'],
  ['Annabel D - Justlife DTC PC HC52', 'Annabel D', 'HC52'],
  ['Plain Name', 'Plain Name', ''],
  ['', '', ''],
];

let fail = 0;
for (const [input, want] of vans) {
  const got = shortVanName(input);
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  van   "${input}" -> "${got}"${ok ? '' : `  (wanted "${want}")`}`);
}
for (const [input, wantName, wantVan] of cleaners) {
  const got = shortCleanerName(input);
  const ok = got.name === wantName && got.van === wantVan;
  if (!ok) fail++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  clnr  "${input}" -> "${got.name}" / "${got.van}"` +
      (ok ? '' : `  (wanted "${wantName}" / "${wantVan}")`),
  );
}
if (fail) process.exitCode = 1;
