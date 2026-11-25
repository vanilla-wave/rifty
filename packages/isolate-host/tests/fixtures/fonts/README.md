# Fonts for the isolate guest's TextDecoder cases (ADR-0577)

`DejaVuSans.ttf`: DejaVu Sans 2.37.3, unmodified, from npm `dejavu-fonts-ttf@2.37.3`
(`ttf/DejaVuSans.ttf`, sha256 `7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954`).
Licence: `LICENSE` beside it (Bitstream Vera and Arev licences; DejaVu changes public domain).
`text-decoder.test.ts` derives a variant with Mac CJK `name` records from it at run time.
