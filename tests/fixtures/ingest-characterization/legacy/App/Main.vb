Imports System.Configuration
Imports System.Data.SqlClient

Public Module MainModule
    Public Function LoadReport() As String
        Dim configured = ConfigurationManager.AppSettings("FeatureFlag")
        Dim query = My.Resources.ActiveUsersQuery
        Dim procedureName = My.Settings.RunReportProc
        Dim command = New SqlCommand("EXEC reporting.RunReport")
        Return configured & query & procedureName & command.CommandText
    End Function
End Module
