// content/form-filler.js — fills Google Form fields via synthetic React events

(function() {
  'use strict';

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

  var delay = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };

  async function fillByQuestion(labelFragment, value) {
    // Google Forms: question titles are in various heading elements
    var allText = document.querySelectorAll('[data-params] span, .freebirdFormviewerComponentsQuestionBaseTitle, [role="heading"]');
    for (var el of allText) {
      if (el.textContent.toLowerCase().includes(labelFragment.toLowerCase())) {
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
    // Fallback: aria-label match
    var inputs = document.querySelectorAll('input[type="text"], textarea');
    for (var inp of inputs) {
      var lbl = (inp.getAttribute('aria-label') || '').toLowerCase();
      if (lbl.includes(labelFragment.toLowerCase())) {
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
    // isoDate = "YYYY-MM-DD"
    var parts = isoDate.split('-'); // [YYYY, MM, DD]
    // Google Forms date fields: three number inputs in order DD / MM / YYYY
    var nums = document.querySelectorAll('input[type="number"]');
    if (nums.length >= 3) {
      setNative(nums[0], parts[2]); await delay(100); // Day
      setNative(nums[1], parts[1]); await delay(100); // Month
      setNative(nums[2], parts[0]); await delay(100); // Year
      return true;
    }
    // Single date input
    var dateInput = document.querySelector('input[type="date"]');
    if (dateInput) { setNative(dateInput, isoDate); return true; }
    return false;
  }

  async function clickRadio(domainText) {
    // Google Forms radio options
    var candidates = document.querySelectorAll('[role="radio"], [data-value]');
    for (var el of candidates) {
      if (el.textContent.trim() === domainText ||
          (el.getAttribute('data-value') || '') === domainText) {
        el.click();
        await delay(200);
        return true;
      }
    }
    // Partial match fallback
    for (var el of candidates) {
      if (el.textContent.toLowerCase().includes(domainText.toLowerCase().slice(0, 15))) {
        el.click();
        await delay(200);
        return true;
      }
    }
    console.warn('[LT Form] Radio not found:', domainText);
    return false;
  }

  async function fillForm(data) {
    console.log('[LT Form] Filling with:', data);

    // 1. Email checkbox (pre-populate logged-in email)
    var emailCb = document.querySelector('input[type="checkbox"]');
    if (emailCb && !emailCb.checked) { emailCb.click(); await delay(200); }

    // 2. Concept
    await fillByQuestion('concept', data.concept || '');
    // 3. Hours
    await fillByQuestion('hours', String(data.hours || ''));
    // 4. Date
    await fillDate(data.date || new Date().toISOString().split('T')[0]);
    // 5. Domain radio
    if (data.domain) await clickRadio(data.domain);
    // 6. Source URL
    await fillByQuestion('source', data.sourceUrl || '');
    // 7. Skill set
    if (data.skillset) await fillByQuestion('skill', data.skillset);
    // 8. Epic link
    if (data.epicLink) await fillByQuestion('epic', data.epicLink);

    await delay(400);
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });

    if (data.autoSubmit) {
      await delay(800);
      var submitBtn = document.querySelector('[role="button"][aria-label*="Submit" i]') ||
                      Array.from(document.querySelectorAll('[role="button"]'))
                           .find(function(b) { return /submit/i.test(b.textContent); });
      if (submitBtn) {
        submitBtn.click();
        console.log('[LT Form] Submitted!');
      }
    }
  }

  // Load pending form data and fill
  chrome.storage.local.get(['lt_pending_form'], function(r) {
    if (r.lt_pending_form) {
      fillForm(r.lt_pending_form);
    }
  });
})();
