import { createRoot } from "react-dom/client";

export default function App() {
  return (
    <div>
      <h1>Welcome to my app</h1>
      <button>hi 123</button>
    </div>
  );
}

const domNode = document.getElementById("root");
const root = createRoot(domNode);

root.render(<App />);
