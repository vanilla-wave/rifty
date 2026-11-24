# python3 verify.py <file>…: second reader for the guest's OOXML outputs (python-pptx 1.0.2,
# python-docx 1.1.2, openpyxl 3.1.5 — independent of the generating libraries). One line per file.
import sys

for path in sys.argv[1:]:
    try:
        if path.endswith('.pptx'):
            import pptx
            p = pptx.Presentation(path)
            texts = [s.text for sh in p.slides[0].shapes if sh.has_text_frame for s in [sh.text_frame]]
            ok = len(p.slides) == 3 and 'Quarterly report' in texts
            detail = f'{len(p.slides)} slides, slide 1 {texts}'
        elif path.endswith('.docx'):
            import docx
            d = docx.Document(path)
            paras = [x.text for x in d.paragraphs]
            ok = 'Quarterly report' in paras and d.tables[0].cell(1, 0).text == 'North'
            detail = f'paragraphs {paras[:2]}, table rows {len(d.tables[0].rows)}'
        elif path.endswith('.xlsx'):
            import openpyxl
            ws = openpyxl.load_workbook(path)['Revenue']
            ok = ws['A1'].value == 'Region' and ws['B4'].value == '=SUM(B2:B3)'
            detail = f"A1 {ws['A1'].value}, B4 {ws['B4'].value}, images {len(ws._images)}"
        else:
            continue
    except Exception as e:  # noqa: BLE001 — the verdict is the output
        ok, detail = False, repr(e)
    print(f"{'ok' if ok else 'FAIL'} {path}: {detail}")
