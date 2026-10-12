resource "aws_sfn_state_machine" "directive" {
  name     = "directive"
  role_arn = "arn:aws:iam::123456789012:role/sfn"

  definition = <<EOF
{
  "StartAt": "A",
  "States": {
%{ if var.enabled }
    "A": { "Type": "Succeed" }
%{ endif }
  }
}
EOF
}
