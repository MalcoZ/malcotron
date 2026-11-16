import { h } from './dom';

function link(href: string, text: string): HTMLAnchorElement {
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer', textContent: text });
}

/** The About dialog: what the app is, and credit for the third-party assets it ships. */
export function createAboutDialog(onResetProgress: () => void): HTMLDialogElement {
  const close = h('button', { type: 'button', className: 'btn', textContent: 'Close' });
  const reset = h('button', {
    type: 'button',
    className: 'btn',
    id: 'reset-progress',
    textContent: 'Reset progress',
  });
  reset.addEventListener('click', () => {
    if (window.confirm('Forget which lessons you have completed? This cannot be undone.')) {
      onResetProgress();
    }
  });
  const dialog = h(
    'dialog',
    { className: 'about', id: 'about-dialog' },
    h('h2', { textContent: 'About Malcotron' }),
    h('p', {
      textContent:
        'Malcotron teaches guitarists who read tab to read standard notation. ' +
        'All music is public domain or written for the app.',
    }),
    h('h3', { textContent: 'Credits and licenses' }),
    h(
      'ul',
      {},
      h(
        'li',
        {},
        'Guitar samples (all four tones): Fluid (R3) General MIDI SoundFont by Frank Wen, rendered to audio files in ',
        link('https://github.com/gleitz/midi-js-soundfonts', 'midi-js-soundfonts'),
        ' by Benjamin Gleitzman. Licensed under ',
        link('https://creativecommons.org/licenses/by/3.0/us/', 'Creative Commons Attribution 3.0'),
        '. The samples are used unchanged.',
      ),
      h(
        'li',
        {},
        'Notation drawn with ',
        link('https://github.com/vexflow/vexflow', 'VexFlow'),
        ' (MIT), using the Bravura and Academico fonts (SIL Open Font License 1.1).',
      ),
      h('li', {}, 'Audio by ', link('https://tonejs.github.io/', 'Tone.js'), ' (MIT).'),
    ),
    h('h3', { textContent: 'Your progress' }),
    h('p', {
      className: 'muted',
      textContent: 'Lesson progress is saved in this browser only.',
    }),
    h('div', { className: 'about-actions' }, reset, close),
  );
  close.addEventListener('click', () => dialog.close());
  return dialog;
}
