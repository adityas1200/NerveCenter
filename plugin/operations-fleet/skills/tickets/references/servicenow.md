# ServiceNow notes

ServiceNow tables, fields, choice values, business rules, and state models are deployment-specific. Discover them rather than assuming a universal incident schema.

## Reading work

- Use stable `sys_id` values for records and references.
- Request actual values and display values intentionally. Display values can depend on user settings and timezone.
- Use a bounded encoded query and paginate.
- Confirm the table in scope: incident, request, requested item, task, change, or a client extension.

## Writing work

- Refresh `sys_mod_count`, state, assignment, and mandatory fields when concurrency matters.
- Use PATCH for a bounded update and return only needed fields.
- Respect state-model and business-rule transitions. ServiceNow can reject an invalid transition through the API just as it does in the UI.
- Read back the record and relevant journal entry after the write.

Official sources:

- [Table API](https://www.servicenow.com/docs/r/api-reference/rest-apis/c_TableAPI.html)
- [State management](https://www.servicenow.com/docs/r/platform-administration/state-management/state-model.html)
- [Incident lifecycle](https://www.servicenow.com/docs/r/it-service-management/incident-management/c_IncidentManagementStateModel.html)
