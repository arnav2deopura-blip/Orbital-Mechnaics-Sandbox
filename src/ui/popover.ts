// A sheet that hangs from a button: opens on the button, closes on Escape, on a press outside, or
// on the button again. The sheet's own content is the caller's.

export interface Popover {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
}

export function popover(opener: HTMLButtonElement, sheet: HTMLElement, onOpen: () => void = () => {}): Popover {
  sheet.hidden = true;
  opener.setAttribute('aria-haspopup', 'true');
  opener.setAttribute('aria-expanded', 'false');
  const api: Popover = {
    get isOpen() {
      return !sheet.hidden;
    },
    open() {
      onOpen();
      sheet.hidden = false;
      opener.setAttribute('aria-expanded', 'true');
    },
    close() {
      sheet.hidden = true;
      opener.setAttribute('aria-expanded', 'false');
    },
  };
  opener.addEventListener('click', () => (api.isOpen ? api.close() : api.open()));
  document.addEventListener('pointerdown', (event) => {
    const target = event.target as Node;
    if (api.isOpen && !sheet.contains(target) && !opener.contains(target)) api.close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && api.isOpen) {
      api.close();
      opener.focus();
    }
  });
  return api;
}
