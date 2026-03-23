// content/form-filler.js — fills Google Form fields; handles “form updated” dialogs & required checkboxes

(function () {
  'use strict';

  function delay(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function setNative(el, value) {
    var proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function getCheckboxContextText(el) {
    var aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
    if (aria) return aria;
    var id = el.id;
    if (id && typeof CSS !== 'undefined' && CSS.escape) {
      var lab = document.querySelector('label[for="' + CSS.escape(id) + '"]');
      if (lab) return lab.textContent;
    }
    var l = el.closest('label');
    if (l) return l.textContent;
    var row = el.closest('[data-params], .freebirdFormviewerViewItemsItemItem, [role="listitem"], .Qr7Oae');
    return (row || el.parentElement || el).textContent || '';
  }

  function isChecked(el) {
    if (el.tagName === 'INPUT' && el.type === 'checkbox') return !!el.checked;
    if (el.getAttribute && el.getAttribute('role') === 'checkbox') {
      return el.getAttribute('aria-checked') === 'true';
    }
    return false;
  }

  function clickCheckbox(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.click();
  }

  /**
   * “Send me a copy of my responses” + “Record … email … included with my response”
   */
  async function ensureRequiredCheckboxes(data) {
    var emailNeedle = (data.formEmail || '').toLowerCase().trim();
    var selectors = 'input[type="checkbox"], [role="checkbox"]';
    var list = document.querySelectorAll(selectors);
    for (var i = 0; i < list.length; i++) {
      var cb = list[i];
      var text = getCheckboxContextText(cb).toLowerCase();
      var wantCopy = /send me a copy|copy of my responses/i.test(text);
      var wantRecord =
        /record\s+.+\s+as the email to be included|included with my response/i.test(text) ||
        (/record/.test(text) && /email/.test(text) && /included/.test(text));
      if (emailNeedle && text.indexOf(emailNeedle) !== -1 && /record|email|included/.test(text)) {
        wantRecord = true;
      }
      if (!wantCopy && !wantRecord) continue;
      if (isChecked(cb)) continue;
      clickCheckbox(cb);
      await delay(220);
    }
  }

  /**
   * Google sometimes shows a dialog after the form is updated (“Save changes”, etc.).
   */
  async function dismissBlockingDialogs(maxMs) {
    var deadline = Date.now() + (maxMs || 12000);
    while (Date.now() < deadline) {
      var dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
      var clicked = false;
      for (var d = 0; d < dialogs.length; d++) {
        var dialog = dialogs[d];
        var buttons = dialog.querySelectorAll('button, [role="button"], span[jsname], div[role="button"]');
        for (var b = 0; b < buttons.length; b++) {
          var btn = buttons[b];
          var t = (btn.textContent || '').trim().toLowerCase();
          if (!t || t.length > 120) continue;
          if (
            t === 'save' || t === 'ok' || t === 'got it' || t === 'continue' ||
            t.indexOf('save') === 0 || t === 'save changes' || t === 'reload' ||
            t === 'update' || /^(view|show)\s/.test(t)
          ) {
            btn.click();
            clicked = true;
            await delay(450);
            break;
          }
        }
      }
      if (!clicked && dialogs.length === 0) await delay(280);
      else if (!clicked) await delay(200);
    }
  }

  async function fillByQuestion(labelFragment, value) {
    var allText = document.querySelectorAll('[data-params] span, .freebirdFormviewerComponentsQuestionBaseTitle, [role="heading"]');
    var i;
    var el;
    for (i = 0; i < allText.length; i++) {
      el = allText[i];
      if (el.textContent.toLowerCase().indexOf(labelFragment.toLowerCase()) !== -1) {
        var container = el.closest('[data-params]') ||
          el.closest('.freebirdFormviewerViewItemsItemItem') ||
          el.closest('[jsmodel]') ||
          el.parentElement;
        if (!container) continue;
        var input = container.querySelector('input[type="text"], textarea');
        if (input) {
          input.focus();
          await delay(80);
          setNative(input, value);
          await delay(250);
          return true;
        }
      }
    }
    var inputs = document.querySelectorAll('input[type="text"], textarea');
    for (i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      var lbl = (inp.getAttribute('aria-label') || '').toLowerCase();
      if (lbl.indexOf(labelFragment.toLowerCase()) !== -1) {
        inp.focus();
        await delay(80);
        setNative(inp, value);
        await delay(250);
        return true;
      }
    }
    console.warn('[LT Form] Field not found:', labelFragment);
    return false;
  }

  async function fillDate(isoDate) {
    var parts = isoDate.split('-');
    var nums = document.querySelectorAll('input[type="number"]');
    if (nums.length >= 3) {
      setNative(nums[0], parts[2]); await delay(100);
      setNative(nums[1], parts[1]); await delay(100);
      setNative(nums[2], parts[0]); await delay(100);
      return true;
    }
    var dateInput = document.querySelector('input[type="date"]');
    if (dateInput) {
      setNative(dateInput, isoDate);
      return true;
    }
    return false;
  }

  async function clickRadio(domainText) {
    var candidates = document.querySelectorAll('[role="radio"], [data-value]');
    var el;
    for (var i = 0; i < candidates.length; i++) {
      el = candidates[i];
      if (el.textContent.trim() === domainText ||
        (el.getAttribute('data-value') || '') === domainText) {
        el.click();
        await delay(200);
        return true;
      }
    }
    for (i = 0; i < candidates.length; i++) {
      el = candidates[i];
      if (el.textContent.toLowerCase().indexOf(domainText.toLowerCase().slice(0, 15)) !== -1) {
        el.click();
        await delay(200);
        return true;
      }
    }
    console.warn('[LT Form] Radio not found:', domainText);
    return false;
  }

  async function clickSubmit() {
    var submitBtn = document.querySelector('[role="button"][aria-label*="Submit" i]');
    if (!submitBtn) {
      var all = document.querySelectorAll('[role="button"]');
      for (var i = 0; i < all.length; i++) {
        if (/submit/i.test(all[i].textContent || '')) {
          submitBtn = all[i];
          break;
        }
      }
    }
    if (submitBtn) {
      submitBtn.click();
      console.log('[LT Form] Submitted');
      return true;
    }
    return false;
  }

  /**
   * Google Forms often lazy-mounts sections until they enter the viewport.
   * Scroll the page first so text/radio inputs exist before we query the DOM.
   */
  async function primeFormViewport() {
    window.scrollTo(0, 0);
    await delay(200);
    var docH = Math.max(
      document.documentElement.scrollHeight || 0,
      document.body && document.body.scrollHeight || 0,
      1
    );
    var steps = 6;
    var i;
    for (i = 1; i <= steps; i++) {
      var y = Math.round((docH * i) / steps);
      window.scrollTo(0, y);
      await delay(220);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await delay(500);
  }

  async function fillForm(data) {
    console.log('[LT Form] Filling with:', data);

    await primeFormViewport();
    await dismissBlockingDialogs(4000);
    await delay(400);
    await ensureRequiredCheckboxes(data);

    await fillByQuestion('concept', data.concept || '');
    await fillByQuestion('hours', String(data.hours || ''));
    await fillDate(data.date || new Date().toISOString().split('T')[0]);
    if (data.domain) await clickRadio(data.domain);
    await fillByQuestion('source', data.sourceUrl || '');
    if (data.skillset) await fillByQuestion('skill', data.skillset);
    if (data.epicLink) await fillByQuestion('epic', data.epicLink);

    await ensureRequiredCheckboxes(data);

    await delay(400);
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });

    if (data.autoSubmit) {
      await delay(900);
      await dismissBlockingDialogs(2500);
      await clickSubmit();
      await delay(1200);
      await dismissBlockingDialogs(10000);
    }
  }

  chrome.storage.local.get(['lt_pending_form'], function (r) {
    if (!r.lt_pending_form) return;
    fillForm(r.lt_pending_form).catch(function (e) {
      console.error('[LT Form]', e);
    });
  });
})();
