import { json } from "@codemirror/lang-json";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";

interface JsonEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
}

export default function JsonEditor({ value, onChange, disabled = false }: JsonEditorProps) {
  return (
    <CodeMirror
      value={value}
      autoFocus={!disabled}
      height="150px"
      theme="dark"
      extensions={[
        json(),
        EditorView.editable.of(!disabled),
        EditorView.contentAttributes.of({
          "aria-label": "Tool arguments",
          "aria-disabled": String(disabled),
          tabindex: disabled ? "-1" : "0",
        }),
      ]}
      basicSetup={{ lineNumbers: true, foldGutter: false }}
      onChange={onChange}
    />
  );
}
