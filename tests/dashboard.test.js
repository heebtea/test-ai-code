// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localDate, shiftDate, sampleData, loadRecords, recordFor, STORAGE_KEY } from '../src/data.js';

describe('日期與模擬資料', () => {
  it('跨月份與跨年切換日期', () => {
    expect(shiftDate('2025-01-01', -1)).toBe('2024-12-31');
    expect(shiftDate('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftDate('2024-02-29', 1)).toBe('2024-03-01');
    expect(shiftDate('2025-02-28', 1)).toBe('2025-03-01');
  });
  it('使用獨立的預設資料並容忍損壞的儲存內容', () => {
    localStorage.setItem(STORAGE_KEY, '{bad');
    expect(loadRecords(localStorage)).toEqual({});
    const first = sampleData(); first.water.amount = 1;
    expect(recordFor({}, '2025-01-01').water.amount).toBe(1500);
  });
});

describe('儀表板互動', () => {
  beforeEach(async () => {
    vi.resetModules(); localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    window.matchMedia = vi.fn(() => ({ matches: false }));
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    await import('../src/main.js');
  });
  it('呈現五個明確標示的模擬資料卡片並切換主題', () => {
    expect(document.querySelectorAll('[data-card]')).toHaveLength(5);
    expect(document.body.textContent).toContain('所有數據皆為虛構範例');
    document.querySelector('#theme').click();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('second-brain-theme')).toBe('dark');
  });
  it('編輯飲水後儲存，日期切換隔離資料並可回復', () => {
    document.querySelector('[data-card="water"]').click();
    document.querySelector('[name="amount"]').value = '1800';
    document.querySelector('#edit-form').requestSubmit();
    expect(document.querySelector('[data-card="water"]').textContent).toContain('1,800');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))[localDate()].water.amount).toBe(1800);
    document.querySelector('#prev').click();
    expect(document.querySelector('[data-card="water"]').textContent).toContain('1,500');
    document.querySelector('#next').click();
    expect(document.querySelector('[data-card="water"]').textContent).toContain('1,800');
  });
  it('拒絕深睡與 REM 合計超過總睡眠', () => {
    document.querySelector('[data-card="sleep"]').click();
    document.querySelector('[name="total"]').value = '2';
    document.querySelector('#edit-form').requestSubmit();
    expect(document.querySelector('#error').textContent).toContain('不能超過');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
  it('以文字顯示使用者輸入的支出明細', () => {
    document.querySelector('[data-card="spending"]').click();
    document.querySelector('[name="detail"]').value = '<img src=x onerror=alert(1)>';
    document.querySelector('#edit-form').requestSubmit();
    expect(document.querySelector('.expense strong').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(document.querySelector('.expense img')).toBeNull();
  });
});
