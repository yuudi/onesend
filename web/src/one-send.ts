import { LitElement, html, css } from 'lit';
import { property, customElement } from 'lit/decorators.js';

@customElement('one-send')
export class OneSend extends LitElement {
  static styles = css``;

  render() {
    return html`
      <h1>One Send</h1>
      It works!
    `;
  }
}
