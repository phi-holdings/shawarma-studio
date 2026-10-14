// The parts of the Hairline kernel the landing page uses (kernel.js is plain JavaScript).
declare const HL: {
  inject(root: Document | ShadowRoot): void;
  mk(tag: string, attrs: Record<string, string>, parent: Element): SVGElement;
  tour(stage: Element, stops: ([number, number] | null)[], onStop?: (i: number) => void): { stop(): void };
  reducedMotion(): boolean;
};
export default HL;
