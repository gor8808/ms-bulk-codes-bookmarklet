(function (root) {
  'use strict';

  function keyEvent(type, params) {
    return {
      method: 'Input.dispatchKeyEvent',
      params: Object.assign({ type }, params)
    };
  }

  function insertText(text) {
    return {
      method: 'Input.insertText',
      params: { text }
    };
  }

  function buildClearSequence() {
    return [
      keyEvent('rawKeyDown', {
        key: 'Control',
        code: 'ControlLeft',
        windowsVirtualKeyCode: 17,
        nativeVirtualKeyCode: 17
      }),
      keyEvent('rawKeyDown', {
        key: 'a',
        code: 'KeyA',
        modifiers: 2,
        windowsVirtualKeyCode: 65,
        nativeVirtualKeyCode: 65
      }),
      keyEvent('keyUp', {
        key: 'a',
        code: 'KeyA',
        modifiers: 2,
        windowsVirtualKeyCode: 65,
        nativeVirtualKeyCode: 65
      }),
      keyEvent('keyUp', {
        key: 'Control',
        code: 'ControlLeft',
        windowsVirtualKeyCode: 17,
        nativeVirtualKeyCode: 17
      }),
      keyEvent('rawKeyDown', {
        key: 'Backspace',
        code: 'Backspace',
        windowsVirtualKeyCode: 8,
        nativeVirtualKeyCode: 8
      }),
      keyEvent('keyUp', {
        key: 'Backspace',
        code: 'Backspace',
        windowsVirtualKeyCode: 8,
        nativeVirtualKeyCode: 8
      })
    ];
  }

  function buildEnterSequence() {
    return [
      keyEvent('rawKeyDown', {
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        unmodifiedText: '\r',
        text: '\r'
      }),
      keyEvent('keyUp', {
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13
      })
    ];
  }

  function buildCodeSequence(code, options) {
    const opts = Object.assign({ clearFirst: false }, options);
    const seq = [];

    if (opts.clearFirst) {
      seq.push.apply(seq, buildClearSequence());
    }

    seq.push(insertText(code));
    seq.push.apply(seq, buildEnterSequence());
    return seq;
  }

  const api = {
    buildCodeSequence,
    buildClearSequence,
    buildEnterSequence
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  root.MSBulkCdpSequence = api;
})(typeof self !== 'undefined' ? self : globalThis);
