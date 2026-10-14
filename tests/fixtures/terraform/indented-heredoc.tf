resource "aws_sfn_state_machine" "indented" {
  name     = "indented"
  role_arn = "arn:aws:iam::123456789012:role/sfn"

  definition = <<-EOT
    {
      "StartAt": "A",
      "States": {
        "A": { "Type": "Pass", "Next": "B" },
        "B": { "Type": "Succeed" }
      }
    }
    EOT
}
