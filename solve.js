// Fast drop-in for csv-reader 1.0.0: same answers, indexOf/slice based.
// Semantics (from the reference): BOM dropped; records end at LF/CRLF;
// empty lines are no records; stray CR outside quotes dropped (stray_cr);
// quoted field runs to next non-doubled quote, "" -> ", CR/CRLF inside -> LF;
// junk after closing quote appended as-is (quote_junk); unterminated quote
// is a literal and the rest is re-read unquoted (unterminated_quote);
// quotes inside unquoted fields are literal; fields stay strings;
// rows padded (short_row, fields) or cut (long_row, extra) to first width;
// errors {code, line, row} in order met, line = 1-based record-start line.
const COMMA = 0, LINE = 1, END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  let line = 1;
  let recordLine = 1;
  let recordRow = null;

  const err = (code) => errors.push({ code, line: recordLine, row: recordRow });

  // Count line breaks in s (LF=1, CRLF=1, lone CR=1) and return s with
  // every CRLF / lone CR turned into LF. Only called when s has \r or \n.
  function normalize(seg) {
    let out = '', start = 0, i = 0;
    while (i < seg.length) {
      const c = seg.charCodeAt(i);
      if (c === 13) { // CR
        out += seg.slice(start, i) + '\n';
        line += 1;
        i += (i + 1 < seg.length && seg.charCodeAt(i + 1) === 10) ? 2 : 1;
        start = i;
      } else if (c === 10) { // LF
        line += 1;
        i += 1;
      } else i += 1;
    }
    return out + seg.slice(start);
  }
  function countLines(seg) {
    for (let i = 0; i < seg.length; i++) {
      const c = seg.charCodeAt(i);
      if (c === 10) line += 1;
      else if (c === 13) { line += 1; if (seg.charCodeAt(i + 1) === 10) i += 1; }
    }
  }

  // Read an unquoted field starting at pos, appending onto `value`.
  // Returns [value, ended] where ended is COMMA/LINE/END.
  function readUnquoted(value) {
    while (pos < n) {
      let c = text.indexOf(',', pos);
      let l = text.indexOf('\n', pos);
      if (c === -1) c = n;
      if (l === -1) l = n;
      const end = c < l ? c : l;
      const kind = c < l ? COMMA : (l < c ? LINE : END);
      const seg = text.slice(pos, end);
      let r = seg.indexOf('\r');
      if (r === -1) {
        value += seg;
        pos = end;
        if (kind === COMMA) { pos += 1; return [value, COMMA]; }
        if (kind === LINE) { pos += 1; line += 1; return [value, LINE]; }
        return [value, END];
      }
      // CR(s) inside the segment: CRLF at its very end is a line break,
      // any other CR is a stray CR, dropped with an error.
      let s = 0;
      while (r !== -1) {
        value += seg.slice(s, r);
        if (r === seg.length - 1 && end === l && end + 1 < n && text.charCodeAt(end + 1) === 10) {
          // unreachable: CRLF's \r is before the \n, so end would be the \r position, not \n
        }
        if (r === seg.length - 1 && kind === LINE) {
          // CR immediately before the LF that ends the segment: CRLF.
          pos = end + 1; line += 1; return [value, LINE];
        }
        err('stray_cr');
        s = r + 1;
        r = seg.indexOf('\r', s);
      }
      value += seg.slice(s);
      pos = end;
      if (kind === COMMA) { pos += 1; return [value, COMMA]; }
      if (kind === LINE) { pos += 1; line += 1; return [value, LINE]; }
      return [value, END];
    }
    return [value, END];
  }

  // Read a quoted field whose opening quote is at pos.
  // Returns [value, ended].
  function readQuoted() {
    const open = pos, openLine = line;
    pos += 1;
    let value = '';
    let segStart = pos;
    while (true) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // Unterminated: opening quote is literal, re-read as unquoted.
        pos = open + 1; line = openLine;
        err('unterminated_quote');
        return readUnquoted('"');
      }
      if (q + 1 < n && text.charCodeAt(q + 1) === 34) {
        // Doubled quote: segment up to q, plus one quote.
        const seg = text.slice(segStart, q);
        value += seg.indexOf('\r') !== -1 || seg.indexOf('\n') !== -1 ? normalize(seg) : (countLines(seg), seg);
        value += '"';
        pos = q + 2; segStart = pos;
        continue;
      }
      // Closing quote at q.
      const seg = text.slice(segStart, q);
      value += seg.indexOf('\r') !== -1 || seg.indexOf('\n') !== -1 ? normalize(seg) : (countLines(seg), seg);
      pos = q + 1;
      if (pos >= n) return [value, END];
      const c = text.charCodeAt(pos);
      if (c === 44) { pos += 1; return [value, COMMA]; }
      if (c === 10) { pos += 1; line += 1; return [value, LINE]; }
      if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; return [value, LINE]; }
      // Junk after closing quote, appended as-is.
      const before = value.length;
      const junk = readUnquoted(value);
      if (junk[0].length > before) err('quote_junk');
      return junk;
    }
  }

  while (true) {
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;
    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    let fields, quoted = false;
    // Fast path: a whole record line with no quote and no CR.
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? n : nl;
    let segEnd = lineEnd;
    if (segEnd > pos && text.charCodeAt(segEnd - 1) === 13) segEnd -= 1;
    const seg = text.slice(pos, segEnd);
    if (seg.indexOf('"') === -1 && seg.indexOf('\r') === -1) {
      fields = seg.split(',');
      pos = nl === -1 ? n : nl + 1;
      line += 1;
    } else {
      fields = [];
      let ended;
      do {
        quoted = text.charCodeAt(pos) === 34;
        const f = quoted ? readQuoted() : readUnquoted('');
        fields.push(f[0]); ended = f[1];
      } while (ended === COMMA);
    }
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    if (width < 0) width = fields.length;
    if (header && columns === null) { columns = fields; continue; }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
