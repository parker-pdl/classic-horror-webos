/* ==========================================================
   LG webOS remote glue.

   The app itself (app.js) is already keyboard/focus driven — every
   card, button and the search box are real <button>/<input>
   elements, so the D-pad's arrow keys move focus and OK/Enter
   activates whatever is focused, for free, in any browser.

   Two things a plain browser build does not have that a TV needs:

     1. The remote's dedicated Back button. webOS delivers it as a
        keydown with keyCode 461 (not Escape). We translate it into
        the same Escape handling app.js already wired up, so Back
        closes the player, then the detail sheet, same as Escape.

     2. Closing the whole app on Back at the very top level (nothing
        open, home screen showing). webOS's own back button should
        exit the app rather than do nothing.
   ========================================================== */

(function () {
    "use strict";

    var BACK_KEYCODE = 461; // LG webOS remote "Back"/"Return" key

    document.addEventListener("keydown", function (e) {
        if (e.keyCode !== BACK_KEYCODE && e.key !== "Backspace") return;

        var player = document.getElementById("player");
        var sheet = document.getElementById("sheet");

        if (player && !player.hidden) {
            e.preventDefault();
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            return;
        }
        if (sheet && !sheet.hidden) {
            e.preventDefault();
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            return;
        }

        // Nothing open — let webOS's platform back behavior (exit to
        // launcher) happen. If running under the webOSTV.js bridge,
        // ask it to close cleanly instead of leaving a blank screen.
        if (window.webOS && window.webOS.platformBack) {
            e.preventDefault();
            window.webOS.platformBack();
        }
    });

    // Make sure something is always focused for the D-pad to move from.
    // A fresh launch or a return to the home grid can otherwise leave
    // focus on <body>, where arrow keys do nothing.
    function ensureFocus() {
        if (document.activeElement && document.activeElement !== document.body) return;
        var first = document.querySelector(".card, #search");
        if (first) first.focus();
    }
    window.addEventListener("load", function () { setTimeout(ensureFocus, 300); });
    document.addEventListener("focusin", function () {}, true);
})();
