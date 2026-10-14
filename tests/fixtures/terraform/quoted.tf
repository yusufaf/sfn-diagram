resource "aws_sfn_state_machine" "quoted" {
  name       = "quoted"
  role_arn   = "arn:aws:iam::123456789012:role/sfn"
  definition = "{\"StartAt\":\"A\",\"States\":{\"A\":{\"Type\":\"Succeed\"}}}"
}
