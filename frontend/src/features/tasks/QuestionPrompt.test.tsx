import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { ToastProvider } from "@/components/ui";
import type { QuestionSpec } from "@/api/inbox";
import { QuestionPrompt } from "./QuestionPrompt";
import { jsonResponse, mockFetch, renderWithClient } from "@/test/utils";

const QUESTIONS: QuestionSpec[] = [
  { question: "Which period should the report cover?", header: "Period", multiSelect: false, options: [{ label: "Last 7 days", description: "Monday to Sunday" }, { label: "Last 30 days", description: "The full month" }] },
  { question: "Which brands?", header: "Brands", multiSelect: true, options: [{ label: "Veltrix" }, { label: "Corvana" }, { label: "Nexora" }] },
];

function mount(ui: ReactElement) {
  return renderWithClient(<ToastProvider>{ui}</ToastProvider>);
}

describe("QuestionPrompt", () => {
  it("takes one answer per single question, many per multi-select, and posts them under the question text", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    mockFetch((url, init) => { calls.push({ url: url, body: init?.body ? JSON.parse(String(init.body)) : null }); return jsonResponse({ id: "I-9", status: "answered" }); });
    mount(<QuestionPrompt inboxId="I-9" questions={QUESTIONS} />);
    expect(screen.getByText("Sonic has 2 questions")).toBeInTheDocument();
    expect(screen.getByText("Period")).toBeInTheDocument();
    expect(screen.getByText("Brands")).toBeInTheDocument();
    expect(screen.getByText("Monday to Sunday")).toBeInTheDocument();
    const send = screen.getByRole("button", { name: "Send answers" });
    expect(send).toBeDisabled();

    await userEvent.click(screen.getByRole("radio", { name: /Last 7 days/ }));
    expect(send).toBeDisabled(); // the second question is still open
    await userEvent.click(screen.getByRole("checkbox", { name: "Veltrix" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Corvana" }));
    expect(send).toBeEnabled();
    // Radios stay exclusive; a second click on another checkbox unpicks it.
    await userEvent.click(screen.getByRole("radio", { name: /Last 30 days/ }));
    expect(screen.getByRole("radio", { name: /Last 7 days/ })).not.toBeChecked();
    await userEvent.click(screen.getByRole("checkbox", { name: "Nexora" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Nexora" }));

    await userEvent.click(send);
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/api/inbox/I-9/answer"))).toBe(true));
    expect(calls.find((call) => call.url.endsWith("/answer"))?.body).toEqual({ answers: { "Which period should the report cover?": "Last 30 days", "Which brands?": "Veltrix, Corvana" } });
    expect(await screen.findByText(/You answered:/)).toBeInTheDocument();
    expect(screen.getByText("Last 30 days · Veltrix, Corvana")).toBeInTheDocument();
  });

  it("sends a typed answer from the Other row, and Skip declines the question", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    mockFetch((url, init) => { calls.push({ url: url, body: init?.body ? JSON.parse(String(init.body)) : null }); return jsonResponse({ id: "I-9", status: "answered" }); });
    const single = [QUESTIONS[0]];
    const { unmount } = mount(<QuestionPrompt inboxId="I-9" questions={single} />);
    expect(screen.getByText("Sonic has a question")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: /Other answer to/ }), "Since 1 September");
    expect(screen.getByRole("radio", { name: "Other" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Send answers" }));
    await waitFor(() => expect(calls.find((call) => call.url.endsWith("/answer"))?.body).toEqual({ answers: { "Which period should the report cover?": "Since 1 September" } }));
    unmount();

    calls.length = 0;
    mount(<QuestionPrompt inboxId="I-10" questions={single} />);
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/api/inbox/I-10/deny"))).toBe(true));
    expect(await screen.findByText("Skipped")).toBeInTheDocument();
  });

  it("renders a settled question as a read-back without a form", () => {
    mount(<QuestionPrompt inboxId="I-11" questions={QUESTIONS} settled={{ status: "answered", answers: { "Which brands?": "Veltrix", "Which period should the report cover?": "Last 7 days" }, by: "Mitesh" }} />);
    expect(screen.queryByRole("button", { name: "Send answers" })).not.toBeInTheDocument();
    expect(screen.getByText("Last 7 days · Veltrix")).toBeInTheDocument();
    expect(screen.getByText(/Mitesh answered/)).toBeInTheDocument();
  });
});

// SPEC-tasks-10 FR-20: a request_input form is the same prompt with typed fields.
describe("QuestionPrompt as a form", () => {
  const FORM: QuestionSpec[] = [
    { question: "From", options: [], field: { type: "date", required: true } },
    { question: "Brands", multiSelect: true, options: [{ label: "Veltrix" }, { label: "Corvana" }], field: { type: "multiselect" } },
    { question: "Include gold?", options: [{ label: "Yes" }, { label: "No" }], field: { type: "boolean" } },
    { question: "Notes", options: [], field: { type: "textarea", placeholder: "Anything else" } },
  ];

  it("draws each field by type, needs only the required ones and sends what was filled in", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    mockFetch((url, init) => { calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null }); return jsonResponse({ id: "I-7", status: "answered" }); });
    mount(<QuestionPrompt inboxId="I-7" questions={FORM} form title="Which period and brands should the report cover?" reason="The weekly report needs a window." />);
    expect(screen.getByText("Which period and brands should the report cover?")).toBeInTheDocument();
    expect(screen.getByText("The weekly report needs a window.")).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toHaveAttribute("type", "date");
    expect(screen.getByPlaceholderText("Anything else").tagName).toBe("TEXTAREA");
    expect(screen.queryByRole("radio", { name: "Other" })).not.toBeInTheDocument();
    const send = screen.getByRole("button", { name: "Send answers" });
    expect(send).toBeDisabled();
    expect(screen.getByText("Fill in From")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("From"), "2026-10-05");
    await userEvent.click(screen.getByRole("checkbox", { name: /Veltrix/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Corvana/ }));
    await userEvent.click(screen.getByRole("radio", { name: /No/ }));
    expect(send).toBeEnabled();
    await userEvent.click(send);
    await waitFor(() => expect(calls.find((entry) => entry.url.endsWith("/api/inbox/I-7/answer"))?.body).toEqual({ answers: { From: "2026-10-05", Brands: "Veltrix, Corvana", "Include gold?": "No" } }));
  });
});
