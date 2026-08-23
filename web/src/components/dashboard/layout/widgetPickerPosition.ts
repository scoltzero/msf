export interface WidgetPickerPosition {
  x: number;
  y: number;
}

export interface WidgetPickerBounds {
  viewportWidth: number;
  viewportHeight: number;
  panelWidth: number;
  panelHeight: number;
  margin?: number;
}

export function clampWidgetPickerPosition(position: WidgetPickerPosition, bounds: WidgetPickerBounds): WidgetPickerPosition {
  const margin = Math.max(0, bounds.margin ?? 12);
  const maxX = Math.max(margin, bounds.viewportWidth - bounds.panelWidth - margin);
  const maxY = Math.max(margin, bounds.viewportHeight - bounds.panelHeight - margin);
  return {
    x: Math.min(Math.max(position.x, margin), maxX),
    y: Math.min(Math.max(position.y, margin), maxY),
  };
}
