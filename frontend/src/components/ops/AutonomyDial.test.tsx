import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import type { TaskPermission } from "@/api/tasks";
import { AutonomyDial, DIAL_LABEL, DIAL_POSITIONS } from "./AutonomyDial";

function Harness({ initial = "policy", allowUnrestricted = false, disabled = false, onChange }: { initial?: TaskPermission; allowUnrestricted?: boolean; disabled?: boolean; onChange?: (value: TaskPermission) => void }) {
  const [value, setValue] = useState<TaskPermission>(initial);
  return <AutonomyDial value={value} onChange={(next) => { setValue(next); onChange?.(next); }} allowUnrestricted={allowUnrestricted} disabled={disabled} />;
}

describe("AutonomyDial", () => {
  it("maps the three permissions to Look only, Ask first and Follow policy, with one help line for the selected one", () => {
    expect(DIAL_LABEL["read-only"]).toBe("Look only");
    expect(DIAL_LABEL.ask).toBe("Ask first");
    expect(DIAL_LABEL.policy).toBe("Follow policy");
    expect(DIAL_LABEL.allow).toBe("Never ask");
    render(<Harness initial="policy" />);
    const group = screen.getByRole("radiogroup", { name: "Permission" });
    expect(within(group).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["Look only", "Ask first", "Follow policy"]);
    expect(within(group).getByRole("radio", { name: "Follow policy" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("autonomy-dial-help")).toHaveTextContent("Everyday changes run. Email, access, production and ticket closure follow the policy in Settings.");
  });

  it("shows Never ask only for admins, or when the value already is allow", () => {
    const { rerender } = render(<AutonomyDial value="ask" onChange={() => {}} />);
    expect(screen.queryByRole("radio", { name: "Never ask" })).not.toBeInTheDocument();
    rerender(<AutonomyDial value="ask" onChange={() => {}} allowUnrestricted />);
    expect(screen.getByRole("radio", { name: "Never ask" })).toBeInTheDocument();
    rerender(<AutonomyDial value="allow" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "Never ask" })).toHaveAttribute("aria-checked", "true");
  });

  it("moves the selection with the arrow keys and wraps at the ends", () => {
    const changes: TaskPermission[] = [];
    render(<Harness initial="read-only" onChange={(value) => changes.push(value)} />);
    const group = screen.getByRole("radiogroup");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Ask first" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("autonomy-dial-help")).toHaveTextContent("Every change waits for your approval");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Look only" })).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(screen.getByRole("radio", { name: "Follow policy" })).toHaveAttribute("aria-checked", "true");
    expect(changes).toEqual(["ask", "policy", "read-only", "policy"]);
  });

  it("selects on click and ignores clicks and keys when disabled", () => {
    const onChange = vi.fn();
    const { rerender } = render(<AutonomyDial value="policy" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Look only" }));
    expect(onChange).toHaveBeenCalledWith("read-only");
    onChange.mockClear();
    rerender(<AutonomyDial value="policy" onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole("radio", { name: "Look only" }));
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowLeft" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radiogroup")).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps the help lines in plain words", () => {
    for (const position of DIAL_POSITIONS) expect(position.help).not.toMatch(/autonom|agentic/i);
  });
});
