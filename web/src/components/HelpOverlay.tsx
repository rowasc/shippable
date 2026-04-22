export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="help" onClick={onClose}>
      <div className="help__box" onClick={(e) => e.stopPropagation()}>
        <div className="help__title">keybindings</div>
        <table className="help__table">
          <tbody>
            <tr><td><kbd>j</kbd>/<kbd>k</kbd></td><td>next / previous line</td></tr>
            <tr><td><kbd>↓</kbd>/<kbd>↑</kbd></td><td>(same)</td></tr>
            <tr><td><kbd>J</kbd>/<kbd>K</kbd></td><td>next / previous hunk</td></tr>
            <tr><td><kbd>Tab</kbd>/<kbd>⇧Tab</kbd></td><td>next / previous file</td></tr>
            <tr><td><kbd>i</kbd></td><td>toggle AI inspector</td></tr>
            <tr><td><kbd>a</kbd></td><td>ack / un-ack AI note on current line</td></tr>
            <tr><td><kbd>r</kbd></td><td>reply to AI note on current line</td></tr>
            <tr><td><kbd>c</kbd></td><td>start a new comment on current line</td></tr>
            <tr><td><kbd>Enter</kbd>/<kbd>y</kbd></td><td>accept guide</td></tr>
            <tr><td><kbd>Esc</kbd>/<kbd>n</kbd></td><td>dismiss guide / close help</td></tr>
            <tr><td><kbd>?</kbd></td><td>toggle this help</td></tr>
          </tbody>
        </table>
        <div className="help__title help__title--sub">testing</div>
        <table className="help__table">
          <tbody>
            <tr><td><kbd>[</kbd>/<kbd>]</kbd></td><td>cycle sample PR</td></tr>
            <tr><td><code>?pr=&lt;id&gt;</code></td><td>load a specific sample on boot</td></tr>
          </tbody>
        </table>
        <div className="help__hint">Lines you've visited are marked as reviewed.</div>
      </div>
    </div>
  );
}
