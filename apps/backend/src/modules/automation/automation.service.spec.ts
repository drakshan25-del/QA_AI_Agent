import { markersFor } from './automation.service';

describe('markersFor (CI marker algebra)', () => {
  it('marks plain UI generations with the ui marker', () => {
    expect(markersFor('ui', false)).toEqual(['ui']);
  });

  it('marks regression UI generations with regression only (never ui)', () => {
    // Regression-UI files must stay out of the `ui and generated` suite.
    expect(markersFor('ui', true)).toEqual(['regression']);
  });

  it('adds no extra markers for plain API generations (engine adds api)', () => {
    expect(markersFor('api', false)).toEqual([]);
  });

  it('marks regression API generations with regression only', () => {
    expect(markersFor('api', true)).toEqual(['regression']);
  });
});
