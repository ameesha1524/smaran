package org.smaran.repo;

import java.util.List;
import org.smaran.domain.ReminderSchedule;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReminderScheduleRepository extends JpaRepository<ReminderSchedule, String> {

    List<ReminderSchedule> findByPatientIdAndActiveTrue(String patientId);

    List<ReminderSchedule> findByActiveTrue();

    void deleteByPatientId(String patientId);
}
