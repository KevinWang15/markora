export type PositionSpace = {
  determinant: number;
  originLeft: number;
  originTop: number;
  scaleX: number;
  scaleY: number;
  xX: number;
  xY: number;
  yX: number;
  yY: number;
};

export function measurePositionSpace(dom: HTMLElement): PositionSpace {
  dom.style.left = "0px";
  dom.style.top = "0px";
  const origin = dom.getBoundingClientRect();

  dom.style.left = "1px";
  const xStep = dom.getBoundingClientRect();

  dom.style.left = "0px";
  dom.style.top = "1px";
  const yStep = dom.getBoundingClientRect();

  dom.style.top = "0px";

  let xX = xStep.left - origin.left;
  let xY = xStep.top - origin.top;
  let yX = yStep.left - origin.left;
  let yY = yStep.top - origin.top;
  let determinant = xX * yY - xY * yX;

  // DOM shims commonly return a fixed rectangle. Translation-only positioning
  // remains the safest fallback when no usable coordinate basis is measurable.
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-6) {
    xX = 1;
    xY = 0;
    yX = 0;
    yY = 1;
    determinant = 1;
  }

  return {
    determinant,
    originLeft: origin.left,
    originTop: origin.top,
    scaleX: Math.hypot(xX, xY) || 1,
    scaleY: Math.hypot(yX, yY) || 1,
    xX,
    xY,
    yX,
    yY,
  };
}

export function setViewportPosition(dom: HTMLElement, left: number, top: number, space = measurePositionSpace(dom)) {
  const deltaLeft = left - space.originLeft;
  const deltaTop = top - space.originTop;
  const localLeft = (deltaLeft * space.yY - deltaTop * space.yX) / space.determinant;
  const localTop = (deltaTop * space.xX - deltaLeft * space.xY) / space.determinant;

  dom.style.left = `${localLeft}px`;
  dom.style.top = `${localTop}px`;
}
