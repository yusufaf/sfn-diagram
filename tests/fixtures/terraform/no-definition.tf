resource "aws_sfn_state_machine" "empty" {
  name     = "empty"
  role_arn = "arn:aws:iam::123456789012:role/sfn"
}
