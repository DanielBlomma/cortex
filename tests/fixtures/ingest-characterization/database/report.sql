CREATE PROCEDURE reporting.RunReport
AS
BEGIN
  SELECT * FROM reporting.ActiveUsers;
END;
