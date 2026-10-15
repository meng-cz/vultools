export type FileKind = 'module' | 'testbench' | 'header';
export interface Span { start: number; end: number }
export interface Issue extends Span { message: string; severity: 'error' | 'warning' }
export interface Attribute { name: string; value: string; explicit: boolean }
export interface BusinessParameter { direction: 'ARG' | 'RESP'; type: string; name: string }
export interface Component extends Span {
  id: string;
  kind: string;
  name: string;
  category: string;
  attributes: Attribute[];
  parameters: BusinessParameter[];
  overrides: Attribute[];
  codeBlocks: Array<{ role: string; code: string; start: number; end: number }>;
  children: Component[];
  condition?: string;
  selected?: boolean;
  relatedIds: string[];
}
export interface ParseResult { fileKind: FileKind; components: Component[]; issues: Issue[] }
export function flatten(components: Component[]): Component[] {
  return components.flatMap(component => [component, ...flatten(component.children)]);
}
