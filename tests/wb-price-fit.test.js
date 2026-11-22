const test = require('node:test');
const assert = require('node:assert/strict');
const { fitToCeiling, parseNumber, parseCeiling } = require('../wb-extension/lib/price-fit.js');

test('screenshot cases: discount first, price fine-tunes', () => {
  const cases = [
    { ceiling: 6696, discount: 57, price: 15572, finalPrice: 6695.96 },
    { ceiling: 6495, discount: 59, price: 15841, finalPrice: 6494.81 },
    { ceiling: 6452, discount: 59, price: 15736, finalPrice: 6451.76 },
    { ceiling: 6387, discount: 59, price: 15578, finalPrice: 6386.98 },
  ];
  for (const c of cases) {
    const r = fitToCeiling({ price: 15490, discount: 52, ceiling: c.ceiling });
    assert.equal(r.ok, true);
    assert.equal(r.discount, c.discount, `discount for ${c.ceiling}`);
    assert.equal(r.price, c.price, `price for ${c.ceiling}`);
    assert.equal(r.finalPrice, c.finalPrice, `final for ${c.ceiling}`);
    assert.equal(r.alreadyQualifies, false);
  }
});

test('final price is always <= ceiling and within 1 ₽ of it', () => {
  for (let price = 500; price <= 40000; price += 137) {
    for (const discount of [0, 10, 33, 52, 70]) {
      for (const ceiling of [199, 999, 4321, 6696, 12000]) {
        const r = fitToCeiling({ price, discount, ceiling });
        if (!r.ok || r.capped) continue;
        assert.ok(r.finalPrice <= ceiling, `${price}/${discount}/${ceiling}: ${r.finalPrice}`);
        assert.ok(ceiling - r.finalPrice < 1, `${price}/${discount}/${ceiling}: gap ${ceiling - r.finalPrice}`);
        assert.ok(r.discount >= discount, 'discount never decreases');
        assert.ok(Number.isInteger(r.discount) && Number.isInteger(r.price));
      }
    }
  }
});

test('already qualifies: keeps discount, raises price to the ceiling', () => {
  const r = fitToCeiling({ price: 15490, discount: 52, ceiling: 8000 });
  assert.equal(r.alreadyQualifies, true);
  assert.equal(r.discount, 52);
  assert.equal(r.price, 16666);
  assert.ok(r.finalPrice <= 8000);
});

test('discount cap: stays at max, lowers price instead', () => {
  const r = fitToCeiling({ price: 10000, discount: 50, ceiling: 100, maxDiscount: 95 });
  assert.equal(r.capped, true);
  assert.equal(r.discount, 95);
  assert.equal(r.price, 2000);
  assert.equal(r.finalPrice, 100);
});

test('exact fit keeps price when it already lands on the ceiling', () => {
  const r = fitToCeiling({ price: 10000, discount: 0, ceiling: 5000 });
  assert.equal(r.discount, 50);
  assert.equal(r.price, 10000);
  assert.equal(r.gap, 0);
});

test('invalid inputs return errors', () => {
  assert.equal(fitToCeiling({ price: NaN, discount: 10, ceiling: 100 }).ok, false);
  assert.equal(fitToCeiling({ price: 100, discount: 100, ceiling: 50 }).ok, false);
  assert.equal(fitToCeiling({ price: 100, discount: 10, ceiling: NaN }).ok, false);
});

test('parsing WB text', () => {
  assert.equal(parseNumber('15 490'), 15490);
  assert.equal(parseNumber('15 490 ₽'), 15490);
  assert.equal(parseNumber('52'), 52);
  assert.equal(parseCeiling('Чёрная пятница (автоакция), до 01.12.26\nдо 35%\n+4\nдо 6 696 ₽'), 6696);
  assert.equal(parseCeiling('до 6 452 ₽'), 6452);
  assert.ok(Number.isNaN(parseCeiling('до 35%')));
});
