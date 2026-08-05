import {
  contentMentionsStep,
  countUnmatchedNotes,
  locatorValidationOf,
} from './automation.service';

/**
 * Locator validation for a generated suite (FR-UIS-025 §2, §4).
 *
 * There is no review stage: a user's approval of a locator is final. The
 * result reported here is computed from the code that was actually generated —
 * never hardcoded, and never from the pre-generation matcher's prediction,
 * which used to flag clean runnable files and block them from executing.
 */
describe('generated-suite locator validation', () => {
  const clean = [
    'import pytest',
    'from playwright.sync_api import Page, expect',
    '',
    'def test_login(page: Page, base_url: str, credentials, target_available) -> None:',
    '    page.goto(base_url)',
    '    page.get_by_role("textbox", name="Username", exact=True).fill(credentials.username)',
    '    page.get_by_role("button", name="Submit", exact=True).click()',
  ].join('\n');

  const withMarker = [
    clean,
    '',
    '    # NO APPROVED LOCATOR MATCHED:',
        '    # "Open the reports menu."',
  ].join('\n');

  describe('counting unmatched notes', () => {
    it('reports none for a file the generator completed', () => {
      expect(countUnmatchedNotes(clean)).toBe(0);
    });

    it('counts each marker the generator emitted', () => {
      expect(countUnmatchedNotes(withMarker)).toBe(1);
      expect(countUnmatchedNotes(`${withMarker}\n    # NO APPROVED LOCATOR MATCHED:`)).toBe(2);
    });

    it('treats an empty file as clean rather than crashing', () => {
      expect(countUnmatchedNotes('')).toBe(0);
    });

    it('does not flag a file that merely mentions the idea of review', () => {
      // The words matter, the marker is what counts.
      expect(countUnmatchedNotes('# every locator here was approved by hand')).toBe(0);
    });
  });

  describe('attributing a marker to a step', () => {
    it('recognises the step it was written for', () => {
      expect(contentMentionsStep(withMarker, 'Open the reports menu.')).toBe(true);
    });

    it('does not claim a step the file never mentions', () => {
      expect(
        contentMentionsStep(withMarker, 'Download the quarterly invoice archive'),
      ).toBe(false);
    });

    it('tolerates the generator rewording a step', () => {
      // The generator writes its own comment rather than quoting verbatim.
      expect(contentMentionsStep(withMarker, 'open reports menu')).toBe(true);
    });

    it('assumes a match when the step text carries no distinctive words', () => {
      // Nothing to match on: better to keep the step listed than to drop it.
      expect(contentMentionsStep(clean, 'do it')).toBe(true);
    });
  });

  describe('the rule the UI depends on', () => {
    it('a file with no note is execution-ready, whatever the matcher predicted', () => {
      const predictedUnresolved = ['Enter a valid email address.', "Click the 'Login' button."];
      const notes = countUnmatchedNotes(clean);
      const actuallyUnresolved =
        notes === 0
          ? []
          : predictedUnresolved.filter((step) => contentMentionsStep(clean, step));

      expect(notes).toBe(0);
      expect(actuallyUnresolved).toEqual([]);
    });

    it('a file with a note still reports the step it left behind', () => {
      const predictedUnresolved = ['Open the reports menu.', 'Print the summary sheet.'];
      const notes = countUnmatchedNotes(withMarker);
      const actuallyUnresolved =
        notes === 0
          ? []
          : predictedUnresolved.filter((step) => contentMentionsStep(withMarker, step));

      expect(notes).toBe(1);
      expect(actuallyUnresolved).toEqual(['Open the reports menu.']);
    });
  });
});

/**
 * The result the Code tab prints (§4). Never hardcoded: it follows from how
 * many steps reused an approved locator and how many had none.
 */
describe('locator validation result', () => {
  it('reports Approved when every step reused an approved locator', () => {
    expect(locatorValidationOf(4, 0)).toBe('approved');
  });

  it('reports a partial result when some steps had no approved match', () => {
    expect(locatorValidationOf(3, 1)).toBe('partial');
  });

  it('reports none when nothing was bound', () => {
    expect(locatorValidationOf(0, 2)).toBe('none');
    expect(locatorValidationOf(0, 0)).toBe('none');
  });

  it('never returns a review status', () => {
    const results = [
      locatorValidationOf(4, 0),
      locatorValidationOf(3, 1),
      locatorValidationOf(0, 0),
    ];
    for (const result of results) {
      expect(result).not.toMatch(/review/i);
    }
  });
});
