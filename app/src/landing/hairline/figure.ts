/** A Hairline figure as its file declares it (see the hairline-create skill's SKILL.md). */
export interface HairlineFigure {
  name: string;
  /** One sentence: what the figure shows. */
  means: string;
  rules: number[];
  /** The figure's own number at intensity 0, 0.5 and 1. */
  range: [number, number, number];
  tour: ([number, number] | null)[] | null;
  mount(ctx: { stage: HTMLElement; svg: SVGElement; read: { textContent: string | null } }, value: number): { set(value: number): void; destroy(): void };
}
