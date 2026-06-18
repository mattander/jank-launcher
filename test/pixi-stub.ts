// Minimal stand-in for pixi.js so logic modules (which import { Graphics } etc.
// from "pixi.js") can be unit-tested under Node without a real canvas. The
// drawing methods are chainable no-ops; tests never call them.
class Graphics {
  moveTo() { return this; }
  lineTo() { return this; }
  poly() { return this; }
  circle() { return this; }
  ellipse() { return this; }
  rect() { return this; }
  fill() { return this; }
  stroke() { return this; }
  clear() { return this; }
  destroy() {}
}
class Container {}
class Application {}
class Text {}

export { Graphics, Container, Application, Text };
