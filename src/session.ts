import { FileKind, ParseResult, parse } from './parser';
/** Keeps UI snapshots tied to the exact document version; edits never publish old results. */
export class DocumentSession {
  version = -1;
  result?: ParseResult;
  stale = true;
  invalidate(version: number): void { if (version !== this.version) this.stale = true; }
  refresh(text: string, version: number, kind: FileKind): ParseResult {
    const result = parse(text, kind);
    this.result = result; this.version = version; this.stale = false; return result;
  }
}
