import { fireEvent, render, screen } from "@testing-library/react";
import { formatTimeOfDay, TimeOfDayPicker } from "./TimeOfDayPicker";

describe("TimeOfDayPicker", () => {
  it("formats 24-hour HH:MM as a plain 12-hour time", () => {
    expect(formatTimeOfDay("09:00")).toBe("9:00 AM");
    expect(formatTimeOfDay("00:30")).toBe("12:30 AM");
    expect(formatTimeOfDay("13:15")).toBe("1:15 PM");
    expect(formatTimeOfDay("12:00")).toBe("12:00 PM");
  });

  it("shows the current time on the trigger and picks a new one from the list, not a native time popup", () => {
    const onChange = vi.fn();
    render(<TimeOfDayPicker aria-label="Time" value="09:00" onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "Time" });
    expect(trigger).toHaveTextContent("9:00 AM");
    expect(trigger.tagName).toBe("BUTTON"); // not a native <input type="time">

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "10:00 AM" }));
    expect(onChange).toHaveBeenCalledWith("10:00");
  });

  it("keeps an off-grid saved value selectable even though it is not one of the 30-minute slots", () => {
    render(<TimeOfDayPicker aria-label="Time" value="09:07" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Time" })).toHaveTextContent("9:07 AM");
    fireEvent.click(screen.getByRole("combobox", { name: "Time" }));
    expect(screen.getByRole("option", { name: "9:07 AM" })).toBeInTheDocument();
  });
});
