// @vitest-environment jsdom
//
// Pins the Task 5 / Task 6 seam against the REAL scorm-again library: the launch
// harness sends `api.getFlattenedCMI()` to POST /api/scorm/commit, and that
// route reads dotted keys like "cmi.core.lesson_status" off the object. Nothing
// else in the suite exercises the library, so a scorm-again version bump could
// silently change that key shape and break the round-trip.
//
// jsdom (not the repo-wide "node" environment) is required because scorm-again
// touches `window`/`document` at construction time. The directive comment above
// scopes that to this one file - every other test in this repo wants "node".
import { describe, it, expect } from "vitest";
import { Scorm12API } from "scorm-again";

describe("scorm-again Scorm12API flattened CMI contract", () => {
  it("getFlattenedCMI() returns dotted 'cmi.core.lesson_status' keys", () => {
    const api = new Scorm12API({ autocommit: false, lmsCommitUrl: false });

    // SCORM 1.2 calling convention: LMSInitialize takes an empty-string param.
    // "true" is the spec's success return value.
    expect(api.LMSInitialize("")).toBe("true");
    expect(api.LMSSetValue("cmi.core.lesson_status", "completed")).toBe("true");

    const flattened = api.getFlattenedCMI();

    expect(Object.prototype.hasOwnProperty.call(flattened, "cmi.core.lesson_status")).toBe(true);
    expect(flattened["cmi.core.lesson_status"]).toBe("completed");
  });
});
